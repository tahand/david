import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PostgresRateLimiter } from '../../lib/rateLimiter.js';
import { sha256 } from '../../lib/tokens.js';
import { TestClient } from '../../test/client.js';
import { fakeEmail, testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import { PASSWORD, createUser, enrolMfa, login, totp } from '../../test/auth-fixtures.js';
import type { AppDeps } from '../../app.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = testPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Generous per-IP limits so functional tests aren't rate limited; limits get their own tests. */
function setup(overrides: Partial<AppDeps> = {}) {
  const built = buildTestApp({
    prisma,
    limiter: new PostgresRateLimiter(prisma),
    rateLimits: { globalPerMinute: 10_000, credentialPerMinute: 10_000 },
    ...overrides,
  });
  const client = () => new TestClient(built.app).init();
  return { ...built, client };
}

const tokenFrom = (text: string) => {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error('no token in email');
  return match[1]!;
};

const clearReplayGuard = (userId: string) =>
  prisma.user.update({ where: { id: userId }, data: { mfaLastTimeStep: null } });

const newPatientBody = (email = fakeEmail('reg')) => ({
  firstName: 'Reggie',
  lastName: 'Example',
  dateOfBirth: '1990-05-04',
  email,
  mobile: '07700 900123',
  password: PASSWORD,
  acceptTerms: true,
});

// -----------------------------------------------------------------------------

describe('CSRF (SPEC §4.6)', () => {
  it('issues a token and a __Host-csrf cookie', async () => {
    const { app } = setup();
    const c = new TestClient(app);
    const res = await c.get('/api/auth/csrf');
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toMatch(/\./);
    expect(c.cookies.get('__Host-csrf')).toBe(res.body.csrfToken);
  });

  it('rejects state-changing requests without a token', async () => {
    const { app } = setup();
    const c = new TestClient(app); // no init(): no token
    const res = await c.post('/api/auth/login', { email: 'a@example.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a forged token even when cookie and header match', async () => {
    const { app } = setup();
    const c = new TestClient(app);
    c.cookies.set('__Host-csrf', 'nonce.forged-signature');
    c.csrfToken = 'nonce.forged-signature';
    const res = await c.post('/api/auth/login', { email: 'a@example.test', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects a foreign Origin', async () => {
    const { app } = setup();
    const c = await new TestClient(app).init();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `__Host-csrf=${c.csrfToken}`)
      .set('X-CSRF-Token', c.csrfToken!)
      .send({ email: 'a@example.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('registration and email verification', () => {
  it('creates a patient with consent and emails a verification link', async () => {
    const { client, mailer } = setup();
    const c = await client();
    const body = { ...newPatientBody(), role: 'admin' }; // unknown field must be stripped
    const res = await c.post('/api/auth/register', body);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: body.email },
      include: { patient: true },
    });
    expect(user.role).toBe('patient');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(user.patient?.consentVersion).toBeTruthy();
    expect(user.patient?.consentAt).toBeInstanceOf(Date);
    expect(user.patient?.phoneMobile).toBe('07700 900123');

    await new Promise((r) => setImmediate(r));
    const email = mailer.last(body.email);
    expect(email?.subject).toMatch(/Confirm your email/);

    const verify = await c.post('/api/auth/verify-email', { token: tokenFrom(email!.text) });
    expect(verify.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).toBeInstanceOf(Date);

    const reuse = await c.post('/api/auth/verify-email', { token: tokenFrom(email!.text) });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_TOKEN');
  });

  it('gives an identical response for an already-registered email (no enumeration)', async () => {
    const { client, mailer } = setup();
    const existing = await createUser(prisma);
    const c = await client();
    const fresh = await c.post('/api/auth/register', newPatientBody());
    const dup = await c.post('/api/auth/register', newPatientBody(existing.email));
    expect(dup.status).toBe(fresh.status);
    expect(dup.body).toEqual(fresh.body);
    await new Promise((r) => setImmediate(r));
    expect(mailer.last(existing.email)?.subject).toMatch(/registration attempt/);
    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);
  });

  it('enforces password rules', async () => {
    const { client } = setup({ isBreached: async (pw) => pw === 'password1234567' });
    const c = await client();
    const email = fakeEmail('pw');
    const cases = [
      { password: 'short' },
      { password: 'x'.repeat(129) },
      { password: `my ${email} password` },
      { password: 'password1234567' },
    ];
    for (const override of cases) {
      const res = await c.post('/api/auth/register', { ...newPatientBody(email), ...override });
      expect(res.status, override.password.slice(0, 20)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('requires accepting the terms', async () => {
    const { client } = setup();
    const c = await client();
    const res = await c.post('/api/auth/register', { ...newPatientBody(), acceptTerms: false });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('acceptTerms');
  });

  it('rejects garbage verification tokens', async () => {
    const { client } = setup();
    const res = await (await client()).post('/api/auth/verify-email', { token: 'x'.repeat(43) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('login and sessions (SPEC §4.3–4.4)', () => {
  it('creates a hashed server-side session in a hardened cookie', async () => {
    const { app, client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', `__Host-csrf=${c.csrfToken}`)
      .set('X-CSRF-Token', c.csrfToken!)
      .send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      role: 'patient',
      mfaEnrolmentRequired: false,
    });
    expect(res.body.session.idleTimeoutMinutes).toBe(60);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((h) =>
      h.startsWith('__Host-sid='),
    )!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);

    const raw = setCookie.split(';')[0]!.split('=')[1]!;
    expect(Buffer.from(raw, 'base64url')).toHaveLength(32);
    const stored = await prisma.session.findUnique({ where: { idHash: sha256(raw) } });
    expect(stored?.userId).toBe(user.id);
    expect(await prisma.session.count({ where: { idHash: raw } })).toBe(0);
  });

  it('returns identical responses for unknown email and wrong password', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const wrong = await login(c, user.email, 'not the right password');
    const unknown = await login(c, fakeEmail('ghost'), 'not the right password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.message).toBe('Email or password is incorrect');
  });

  it('records login success and failure in the audit log', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await login(c, user.email, 'wrong password!!');
    await login(c, user.email);
    const actions = (await prisma.auditLog.findMany({ where: { actorUserId: user.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['auth.login.failure', 'auth.login.success']));
  });

  it('rejects deactivated and soft-deleted users with the generic error', async () => {
    const { client } = setup();
    const inactive = await createUser(prisma);
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    const res = await login(await client(), inactive.email);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates the session ID on each login and destroys it on logout', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await login(c, user.email);
    const first = c.sessionCookie!;
    await login(c, user.email);
    const second = c.sessionCookie!;
    expect(second).not.toBe(first);
    expect(await prisma.session.findUnique({ where: { idHash: sha256(first) } })).toBeNull();

    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect(await prisma.session.findUnique({ where: { idHash: sha256(second) } })).toBeNull();
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('requires authentication for /me', async () => {
    const res = await (await setup().client()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expires idle sessions: 60 min for patients, 30 min for staff', async () => {
    const { client } = setup();
    const ago = (min: number) => new Date(Date.now() - min * 60_000);

    const patient = await createUser(prisma);
    const p = await client();
    await login(p, patient.email);
    const pSid = sha256(p.sessionCookie!);
    await prisma.session.update({ where: { idHash: pSid }, data: { lastSeenAt: ago(45) } });
    expect((await p.get('/api/auth/me')).status).toBe(200);
    await prisma.session.update({ where: { idHash: pSid }, data: { lastSeenAt: ago(61) } });
    expect((await p.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.findUnique({ where: { idHash: pSid } })).toBeNull();

    const staff = await createUser(prisma, { role: 'receptionist' });
    const s = await client();
    await login(s, staff.email);
    await prisma.session.update({
      where: { idHash: sha256(s.sessionCookie!) },
      data: { lastSeenAt: ago(31) },
    });
    expect((await s.get('/api/auth/me')).status).toBe(401);
  });

  it('enforces the 12-hour absolute timeout', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await login(c, user.email);
    await prisma.session.update({
      where: { idHash: sha256(c.sessionCookie!) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('brute-force protection (SPEC §4.5)', () => {
  it('locks the account after 10 consecutive failures and emails the user', async () => {
    const { client, mailer } = setup();
    const user = await createUser(prisma);
    const c = await client();
    for (let i = 0; i < 10; i++) {
      expect((await login(c, user.email, `wrong password ${i}`)).status).toBe(401);
    }
    const locked = await login(c, user.email); // correct password, still locked
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await new Promise((r) => setImmediate(r));
    expect(mailer.last(user.email)?.subject).toMatch(/locked/);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: user.id, action: 'auth.account.locked' },
      }),
    ).toBe(1);
  });

  it('shows the same lockout response for unknown emails', async () => {
    const { client } = setup();
    const ghost = fakeEmail('ghost');
    const known = await createUser(prisma);
    const c = await client();
    for (let i = 0; i < 10; i++) {
      await login(c, ghost, 'wrong password!!');
      await login(c, known.email, 'wrong password!!');
    }
    const a = await login(c, ghost, 'wrong password!!');
    const b = await login(c, known.email, 'wrong password!!');
    expect(a.status).toBe(423);
    expect(b.status).toBe(423);
    expect(a.body).toEqual(b.body);
  });

  it('allows login again after the lock expires', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await login(await client(), user.email)).status).toBe(200);
  });

  it('rate limits credential endpoints to 5 per minute per IP', async () => {
    const { app } = buildTestApp({ prisma, limiter: new PostgresRateLimiter(prisma) });
    const c = await new TestClient(app).init();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await login(c, fakeEmail(), 'whatever password')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    const limited = await login(c, fakeEmail(), 'whatever password');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // A different IP is unaffected.
    const other = await new TestClient(app).init();
    expect((await login(other, fakeEmail(), 'whatever password')).status).toBe(401);
  });

  it('applies a global per-IP limit to every API route', async () => {
    const { app } = buildTestApp({
      prisma,
      limiter: new PostgresRateLimiter(prisma),
      rateLimits: { globalPerMinute: 3 },
    });
    const c = new TestClient(app);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await c.get('/api/auth/csrf')).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('MFA (SPEC §4.1, §4.4)', () => {
  it('enrols with an encrypted secret and 10 recovery codes', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const before = (await login(c, user.email), c.sessionCookie);
    const { secret, recoveryCodes, setup: s, enabled } = await enrolMfa(c, user.email);

    expect(s.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(s.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(enabled.status).toBe(200);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(recoveryCodes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaEnabled).toBe(true);
    expect(row.mfaSecretEnc).toMatch(/^v1:/);
    expect(row.mfaSecretEnc).not.toContain(secret);
    const codes = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(codes).toHaveLength(10);
    expect(codes.map((x) => x.codeHash)).not.toContain(recoveryCodes[0]!.replace('-', ''));

    // MFA completion rotated the session.
    expect(c.sessionCookie).not.toBe(before);
    expect((await c.get('/api/auth/me')).body.user.mfaEnabled).toBe(true);
  });

  it('requires the code after the password, and rotates the session', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const { secret } = await enrolMfa(await client(), user.email);
    await clearReplayGuard(user.id);

    const c = await client();
    const first = await login(c, user.email);
    expect(first.body).toEqual({ mfaRequired: true });
    const pending = c.sessionCookie!;
    expect((await c.get('/api/auth/me')).status).toBe(401);

    const bad = await c.post('/api/auth/mfa/verify', { code: '000000' });
    expect(bad.status).toBe(400);
    const ok = await c.post('/api/auth/mfa/verify', { code: await totp(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(user.id);
    expect(c.sessionCookie).not.toBe(pending);
    expect(await prisma.session.findUnique({ where: { idHash: sha256(pending) } })).toBeNull();
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('rejects a replayed TOTP code', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const { secret } = await enrolMfa(await client(), user.email);
    await clearReplayGuard(user.id);
    const code = await totp(secret);

    const a = await client();
    await login(a, user.email);
    expect((await a.post('/api/auth/mfa/verify', { code })).status).toBe(200);

    const b = await client();
    await login(b, user.email);
    expect((await b.post('/api/auth/mfa/verify', { code })).status).toBe(400);
  });

  it('accepts each recovery code exactly once', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const { recoveryCodes } = await enrolMfa(await client(), user.email);
    const code = recoveryCodes[3]!;

    const a = await client();
    await login(a, user.email);
    expect(
      (await a.post('/api/auth/mfa/verify', { recoveryCode: code.toUpperCase() })).status,
    ).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: user.id, action: 'auth.mfa.recovery_code_used' },
      }),
    ).toBe(1);

    const b = await client();
    await login(b, user.email);
    expect((await b.post('/api/auth/mfa/verify', { recoveryCode: code })).status).toBe(400);
  });

  it('expires the pending-MFA session after 5 minutes', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const { secret } = await enrolMfa(await client(), user.email);
    await clearReplayGuard(user.id);
    const c = await client();
    await login(c, user.email);
    const pending = await prisma.session.findUniqueOrThrow({
      where: { idHash: sha256(c.sessionCookie!) },
    });
    expect(pending.mfaPending).toBe(true);
    expect(pending.expiresAt.getTime() - pending.createdAt.getTime()).toBeLessThanOrEqual(
      5 * 60_000 + 1000,
    );
    await prisma.session.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await c.post('/api/auth/mfa/verify', { code: await totp(secret) })).status).toBe(401);
  });

  it('destroys the pending session after 5 wrong codes', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const { secret } = await enrolMfa(await client(), user.email);
    await clearReplayGuard(user.id);
    const c = await client();
    await login(c, user.email);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/mfa/verify', { code: '000000' });
    expect((await c.post('/api/auth/mfa/verify', { code: await totp(secret) })).status).toBe(401);
  });

  it('lets a patient disable MFA with password and code, signing out other devices', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const { secret } = await enrolMfa(c, user.email);
    await clearReplayGuard(user.id);

    const other = await client();
    await login(other, user.email);
    await other.post('/api/auth/mfa/verify', { code: await totp(secret) });
    await clearReplayGuard(user.id);

    const wrongPw = await c.post('/api/auth/mfa/disable', {
      password: 'nope nope nope',
      code: await totp(secret),
    });
    expect(wrongPw.status).toBe(400);
    const res = await c.post('/api/auth/mfa/disable', {
      password: PASSWORD,
      code: await totp(secret),
    });
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaEnabled).toBe(false);
    expect(row.mfaSecretEnc).toBeNull();
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('does not let staff disable MFA', async () => {
    const { client } = setup();
    const doctor = await createUser(prisma, { role: 'doctor' });
    const c = await client();
    const { secret } = await enrolMfa(c, doctor.email);
    await clearReplayGuard(doctor.id);
    const res = await c.post('/api/auth/mfa/disable', {
      password: PASSWORD,
      code: await totp(secret),
    });
    expect(res.status).toBe(403);
  });

  it('regenerates recovery codes, invalidating the old set', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const { secret, recoveryCodes: old } = await enrolMfa(c, user.email);
    await clearReplayGuard(user.id);
    const res = await c.post('/api/auth/mfa/recovery-codes', { code: await totp(secret) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);

    const d = await client();
    await login(d, user.email);
    expect((await d.post('/api/auth/mfa/verify', { recoveryCode: old[0] })).status).toBe(400);
    expect(
      (await d.post('/api/auth/mfa/verify', { recoveryCode: res.body.recoveryCodes[0] })).status,
    ).toBe(200);
  });
});

describe('forced staff MFA enrolment (SPEC §4.1)', () => {
  it.each(['doctor', 'receptionist', 'admin'] as const)(
    'confines a %s without MFA to the enrolment endpoints',
    async (role) => {
      const { client } = setup();
      const staff = await createUser(prisma, { role });
      const c = await client();
      const res = await login(c, staff.email);
      expect(res.status).toBe(200);
      expect(res.body.user.mfaEnrolmentRequired).toBe(true);
      expect(res.body.session.idleTimeoutMinutes).toBe(30);

      const blocked = await c.get('/api/auth/sessions');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('MFA_ENROLMENT_REQUIRED');
      expect(
        (
          await c.post('/api/auth/change-password', {
            currentPassword: PASSWORD,
            newPassword: 'another long password',
          })
        ).status,
      ).toBe(403);

      expect((await c.get('/api/auth/me')).status).toBe(200);
      const setupRes = await c.post('/api/auth/mfa/setup');
      expect(setupRes.status).toBe(200);
      const enable = await c.post('/api/auth/mfa/enable', {
        code: await totp(setupRes.body.manualKey),
      });
      expect(enable.status).toBe(200);
      expect((await c.get('/api/auth/sessions')).status).toBe(200);
    },
  );

  it('patients are not forced to enrol', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await login(c, user.email);
    expect((await c.get('/api/auth/sessions')).status).toBe(200);
  });
});

describe('password reset (SPEC §4.1.5)', () => {
  it('responds identically for known and unknown emails', async () => {
    const { client, mailer } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const ghost = fakeEmail('ghost');
    const a = await c.post('/api/auth/forgot-password', { email: user.email });
    const b = await c.post('/api/auth/forgot-password', { email: ghost });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body.message).toBe("If an account exists, we've emailed you a link");
    await new Promise((r) => setImmediate(r));
    expect(mailer.to(user.email)).toHaveLength(1);
    expect(mailer.to(ghost)).toHaveLength(0);
  });

  it('resets once with a 30-minute token and signs out every session', async () => {
    const { client, mailer } = setup();
    const user = await createUser(prisma);
    const loggedIn = await client();
    await login(loggedIn, user.email);

    const c = await client();
    await c.post('/api/auth/forgot-password', { email: user.email });
    await new Promise((r) => setImmediate(r));
    const token = tokenFrom(mailer.last(user.email)!.text);
    const row = await prisma.emailToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
      30 * 60_000 + 1000,
    );

    const newPassword = 'a brand new passphrase';
    const res = await c.post('/api/auth/reset-password', { token, password: newPassword });
    expect(res.status).toBe(200);
    expect((await loggedIn.get('/api/auth/me')).status).toBe(401);
    expect((await login(await client(), user.email)).status).toBe(401);
    expect((await login(await client(), user.email, newPassword)).status).toBe(200);

    const again = await c.post('/api/auth/reset-password', {
      token,
      password: 'yet another passphrase',
    });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired tokens and superseded tokens', async () => {
    const { client, mailer } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await c.post('/api/auth/forgot-password', { email: user.email });
    await new Promise((r) => setImmediate(r));
    const first = tokenFrom(mailer.last(user.email)!.text);
    await c.post('/api/auth/forgot-password', { email: user.email });
    await new Promise((r) => setImmediate(r));
    const second = tokenFrom(mailer.last(user.email)!.text);

    expect(
      (
        await c.post('/api/auth/reset-password', {
          token: first,
          password: 'a brand new passphrase',
        })
      ).status,
    ).toBe(400);
    await prisma.emailToken.update({
      where: { tokenHash: sha256(second) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(
      (
        await c.post('/api/auth/reset-password', {
          token: second,
          password: 'a brand new passphrase',
        })
      ).status,
    ).toBe(400);
  });

  it('applies the password policy without consuming the token', async () => {
    const { client, mailer } = setup();
    const user = await createUser(prisma);
    const c = await client();
    await c.post('/api/auth/forgot-password', { email: user.email });
    await new Promise((r) => setImmediate(r));
    const token = tokenFrom(mailer.last(user.email)!.text);
    const weak = await c.post('/api/auth/reset-password', { token, password: `${user.email}!!` });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      (await c.post('/api/auth/reset-password', { token, password: 'a brand new passphrase' }))
        .status,
    ).toBe(200);
  });
});

describe('change password', () => {
  it('requires the current password and signs out other sessions', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const c = await client();
    const other = await client();
    await login(c, user.email);
    await login(other, user.email);
    const before = c.sessionCookie;

    const wrong = await c.post('/api/auth/change-password', {
      currentPassword: 'wrong wrong wrong',
      newPassword: 'a brand new passphrase',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await c.post('/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new passphrase',
    });
    expect(ok.status).toBe(200);
    expect(c.sessionCookie).not.toBe(before);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('returns 401 when not signed in', async () => {
    const res = await (
      await setup().client()
    ).post('/api/auth/change-password', {
      currentPassword: 'x',
      newPassword: 'a brand new passphrase',
    });
    expect(res.status).toBe(401);
  });
});

describe('session management', () => {
  it('lists own sessions and revokes one', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const a = await client();
    const b = await client();
    await login(a, user.email);
    await login(b, user.email);

    const list = await a.get('/api/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    const current = list.body.sessions.find((s: { current: boolean }) => s.current);
    const otherSession = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect(current.ip).toBe(a.ip);
    expect(JSON.stringify(list.body)).not.toContain(a.sessionCookie!);

    expect((await a.delete(`/api/auth/sessions/${otherSession.id}`)).status).toBe(204);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await a.get('/api/auth/me')).status).toBe(200);
  });

  it("returns 404 for someone else's session or a malformed id", async () => {
    const { client } = setup();
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const a = await client();
    const b = await client();
    await login(a, alice.email);
    await login(b, bob.email);
    const bobSession = await prisma.session.findUniqueOrThrow({
      where: { idHash: sha256(b.sessionCookie!) },
    });

    expect((await a.delete(`/api/auth/sessions/${bobSession.id}`)).status).toBe(404);
    expect((await a.delete('/api/auth/sessions/not-a-uuid')).status).toBe(404);
    expect((await b.get('/api/auth/me')).status).toBe(200);
  });

  it('logs out of all devices', async () => {
    const { client } = setup();
    const user = await createUser(prisma);
    const a = await client();
    const b = await client();
    await login(a, user.email);
    await login(b, user.email);
    expect((await a.post('/api/auth/logout-all')).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
