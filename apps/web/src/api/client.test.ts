import { describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { api, ApiError, setGlobalHandlers } from './client';

function handlers() {
  const h = { onUnauthorized: vi.fn(), onForbidden: vi.fn(), onMfaEnrolmentRequired: vi.fn() };
  setGlobalHandlers(h);
  return h;
}

describe('API client', () => {
  it('sends no CSRF header on GET and fetches the token once for writes', async () => {
    const { calls, callsTo } = mockApi({
      'GET /api/things': { body: { ok: true } },
      'POST /api/things': { body: { ok: true } },
    });
    await api.get('/things');
    await api.post('/things', { a: 1 });
    await api.post('/things', { a: 2 });
    expect(calls[0]!.headers['X-CSRF-Token']).toBeUndefined();
    expect(callsTo('GET', '/api/auth/csrf')).toHaveLength(1);
    expect(
      callsTo('POST', '/api/things').every((c) => c.headers['X-CSRF-Token'] === 'test-csrf'),
    ).toBe(true);
  });

  it('refreshes the CSRF token and retries once on CSRF_INVALID', async () => {
    let attempts = 0;
    const { callsTo } = mockApi({
      'POST /api/things': () =>
        ++attempts === 1 ? apiError(403, 'CSRF_INVALID') : { body: { ok: true } },
    });
    await expect(api.post('/things')).resolves.toEqual({ ok: true });
    expect(callsTo('GET', '/api/auth/csrf')).toHaveLength(2);
  });

  it('routes 401, 403 and MFA-enrolment errors to the global handlers', async () => {
    const h = handlers();
    mockApi({
      'GET /api/a': apiError(401, 'UNAUTHENTICATED'),
      'GET /api/b': apiError(403, 'FORBIDDEN'),
      'GET /api/c': apiError(403, 'MFA_ENROLMENT_REQUIRED'),
    });
    await expect(api.get('/a')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/b')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.get('/c')).rejects.toMatchObject({ code: 'MFA_ENROLMENT_REQUIRED' });
    expect(h.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(h.onForbidden).toHaveBeenCalledTimes(1);
    expect(h.onMfaEnrolmentRequired).toHaveBeenCalledTimes(1);
  });

  it('lets auth screens opt out of global handling', async () => {
    const h = handlers();
    mockApi({
      'POST /api/auth/login': apiError(
        401,
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
      ),
    });
    await expect(api.post('/auth/login', {}, { globalErrors: false })).rejects.toMatchObject({
      status: 401,
      message: 'Email or password is incorrect',
    });
    expect(h.onUnauthorized).not.toHaveBeenCalled();
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});
