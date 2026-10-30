import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { buildTestApp } from './test/helpers.js';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './lib/errors.js';

describe('GET /api/health', () => {
  it('returns ok when the DB is reachable', async () => {
    const res = await request(buildTestApp().app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 without leaking details when the DB is down', async () => {
    const { app } = buildTestApp({
      checkDb: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      },
    });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error' });
  });
});

describe('security headers', () => {
  it('sets CSP, HSTS and related headers', async () => {
    const res = await request(buildTestApp().app).get('/api/health');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;frame-ancestors 'none';base-uri 'self';form-action 'self'",
    );
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('returns the consistent 404 shape for unknown API routes', async () => {
    const res = await request(buildTestApp().app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('rejects bodies over 100 KB with 413', async () => {
    const res = await request(buildTestApp().app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(110 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(buildTestApp().app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  const harness = (thrower: () => void) => {
    const app = express();
    app.get('/boom', () => thrower());
    app.use(errorHandler);
    return app;
  };

  it('maps ZodError to 400 VALIDATION_ERROR with details', async () => {
    const app = harness(() => {
      z.object({ email: z.email() }).parse({ email: 'nope' });
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('email');
  });

  it('passes AppError status and message through', async () => {
    const app = harness(() => {
      throw AppError.forbidden();
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('hides internal error details and stack traces', async () => {
    const app = harness(() => {
      throw new Error('relation "users" does not exist');
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });
});
