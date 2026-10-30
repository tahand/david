import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { AuthMeResponse, Role } from '@clinic/shared';
import { routes } from '../router';

type Reply = { status?: number; body?: unknown };
type Handler = Reply | ((body: unknown) => Reply | Promise<Reply>);

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const apiError = (
  status: number,
  code: string,
  message = code,
  details?: unknown[],
): Reply => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});

const SIGNS_IN = new Set(['POST /api/auth/login', 'POST /api/auth/mfa/verify']);
const SIGNS_OUT = new Set(['POST /api/auth/logout', 'POST /api/auth/logout-all']);

/**
 * Stubs `fetch` with a route table keyed by "METHOD /api/path". Unlisted
 * routes 404.
 *
 * Unless a test supplies its own `GET /api/auth/me`, the mock keeps a session
 * like the server does: 401 until a login or MFA verification returns a user,
 * then that user, until logout. Otherwise any legitimate refetch of /me after
 * signing in would look like the session ending.
 */
export function mockApi(table: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  let sessionUser: unknown = null;
  const routesTable: Record<string, Handler> = {
    'GET /api/auth/csrf': { body: { csrfToken: 'test-csrf' } },
    'GET /api/auth/me': () =>
      sessionUser ? { body: sessionUser } : apiError(401, 'UNAUTHENTICATED'),
    'GET /api/clinic': {
      body: {
        clinicName: 'Test Clinic',
        clinicPhone: '01632 960000',
        clinicAddress: '1 Test St',
        consentVersion: 'v-test',
        healthIdLabel: 'NHS number',
        timezone: 'Europe/London',
        theme: 'trust-and-calm',
      },
    },
    ...table,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: (init.headers ?? {}) as Record<string, string> });
    const key = `${method} ${path}`;
    const handler = routesTable[key];
    if (!handler) return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const reply = typeof handler === 'function' ? await handler(body) : handler;
    const status = reply.status ?? 200;
    if (status < 300 && SIGNS_IN.has(key) && (reply.body as { user?: unknown } | null)?.user) {
      sessionUser = reply.body;
    }
    if (status < 300 && SIGNS_OUT.has(key)) sessionUser = null;
    return json(reply.body ?? null, status);
  });
  vi.stubGlobal('fetch', fetchMock);
  const callsTo = (method: string, path: string) =>
    calls.filter((c) => c.method === method && c.path === path);
  return { calls, callsTo, fetchMock, routes: routesTable };
}

export function meFor(role: Role, overrides: Partial<AuthMeResponse['user']> = {}): AuthMeResponse {
  const staff = role !== 'patient';
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: `${role}@example.test`,
      role,
      emailVerified: true,
      mfaEnabled: staff,
      mfaEnrolmentRequired: false,
      ...overrides,
    },
    session: {
      idleTimeoutMinutes: staff ? 30 : 60,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  };
}

/** Renders the real route tree at `path` inside StrictMode. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...utils, router, queryClient };
}

export const currentPath = (router: ReturnType<typeof createMemoryRouter>) =>
  router.state.location.pathname + router.state.location.search;
