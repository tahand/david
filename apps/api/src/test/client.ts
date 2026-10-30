import { randomInt } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response, type Test } from 'supertest';
import { TEST_ORIGIN } from './helpers.js';

/**
 * Browser-like API client for tests. Supertest's agent will not send Secure
 * cookies over plain http, and `__Host-` cookies must be Secure, so cookies
 * are tracked by hand. Each client gets its own IP (via X-Forwarded-For with
 * `trust proxy`) so per-IP rate limits don't leak between tests.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();
  csrfToken?: string;
  readonly ip: string;

  constructor(
    private readonly app: Express,
    ip?: string,
  ) {
    this.ip = ip ?? `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  }

  private prepare(test: Test, withCsrf: boolean): Test {
    test.set('Origin', TEST_ORIGIN).set('X-Forwarded-For', this.ip);
    if (this.cookies.size > 0) {
      test.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    if (withCsrf && this.csrfToken) test.set('X-CSRF-Token', this.csrfToken);
    return test;
  }

  private capture(res: Response): Response {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const line of raw ?? []) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const expired = /expires=Thu, 01 Jan 1970/i.test(line);
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  /** Fetches a CSRF token (sets the cookie) like the SPA does on start-up. */
  async init(): Promise<this> {
    const res = await this.get('/api/auth/csrf');
    this.csrfToken = res.body.csrfToken;
    return this;
  }

  async get(path: string): Promise<Response> {
    return this.capture(await this.prepare(request(this.app).get(path), false));
  }

  async post(path: string, body: object = {}): Promise<Response> {
    return this.capture(await this.prepare(request(this.app).post(path), true).send(body));
  }

  async delete(path: string): Promise<Response> {
    return this.capture(await this.prepare(request(this.app).delete(path), true));
  }

  get sessionCookie(): string | undefined {
    return this.cookies.get('__Host-sid');
  }
}
