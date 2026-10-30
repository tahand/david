import type { ApiError as ApiErrorBody, ErrorCode } from '@clinic/shared';

/** An error response from the API in the shape defined in SPEC §9. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: { path?: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface GlobalHandlers {
  onUnauthorized: () => void;
  onForbidden: () => void;
  onMfaEnrolmentRequired: () => void;
}

const noop = () => {};
let handlers: GlobalHandlers = {
  onUnauthorized: noop,
  onForbidden: noop,
  onMfaEnrolmentRequired: noop,
};

/** Registered once by the app shell, which owns navigation (SPEC §10). */
export function setGlobalHandlers(next: GlobalHandlers): void {
  handlers = next;
}

// The CSRF token is held in memory only — never in web storage (SPEC §10).
let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;
let lastRequestAt = Date.now();
const activityListeners = new Set<(at: number) => void>();

/** Time of the last successful API call; the server's idle timer resets on requests. */
export const getLastRequestAt = () => lastRequestAt;
export function onApiActivity(listener: (at: number) => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

async function fetchCsrfToken(): Promise<string> {
  csrfPromise ??= fetch('/api/auth/csrf', { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok)
        throw new ApiError(res.status, 'INTERNAL_ERROR', 'Could not start a secure session');
      const body = (await res.json()) as { csrfToken: string };
      csrfToken = body.csrfToken;
      return body.csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export function resetClientState(): void {
  csrfToken = null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * When false, 401/403 are returned to the caller instead of triggering the
   * global redirect. Auth screens use this to show inline errors.
   */
  globalErrors?: boolean;
  signal?: AbortSignal;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body.error) {
      return new ApiError(
        res.status,
        body.error.code,
        body.error.message,
        (body.error.details ?? []) as { path?: string; message: string }[],
      );
    }
  } catch {
    // fall through
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const mutating = method !== 'GET';

  const send = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (mutating) headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrfToken());
    return fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 403 && mutating) {
      const err = await toApiError(res.clone());
      if (err.code === 'CSRF_INVALID') {
        // Token cookie may have been lost (e.g. new browser session); refresh once.
        csrfToken = null;
        res = await send();
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection.');
  }

  if (res.ok) {
    lastRequestAt = Date.now();
    activityListeners.forEach((l) => l(lastRequestAt));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const error = await toApiError(res);
  if (opts.globalErrors !== false) {
    if (error.status === 401) handlers.onUnauthorized();
    else if (error.code === 'MFA_ENROLMENT_REQUIRED') handlers.onMfaEnrolmentRequired();
    else if (error.status === 403 && error.code === 'FORBIDDEN') handlers.onForbidden();
  }
  throw error;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body: body ?? {} }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};
