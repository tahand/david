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

/**
 * Stubs `fetch` with a route table keyed by "METHOD /api/path". Unlisted
 * routes 404; `/api/auth/me` defaults to 401 (signed out).
 */
export function mockApi(table: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const routesTable: Record<string, Handler> = {
    'GET /api/auth/csrf': { body: { csrfToken: 'test-csrf' } },
    'GET /api/auth/me': apiError(401, 'UNAUTHENTICATED'),
    'GET /api/clinic': {
      body: {
        clinicName: 'Test Clinic',
        clinicPhone: '01632 960000',
        clinicAddress: '1 Test St',
        consentVersion: 'v-test',
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
    const handler = routesTable[`${method} ${path}`];
    if (!handler) return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const reply = typeof handler === 'function' ? await handler(body) : handler;
    return json(reply.body ?? null, reply.status ?? 200);
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
