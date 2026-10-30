import type { PrismaClient, Role } from '@prisma/client';
import { generate } from 'otplib';
import { hashPassword } from '../lib/password.js';
import { fakeEmail } from './db.js';
import type { TestClient } from './client.js';

export const PASSWORD = 'correct horse battery staple';

export async function createUser(
  prisma: PrismaClient,
  opts: { role?: Role; password?: string; verified?: boolean; email?: string } = {},
) {
  const role = opts.role ?? 'patient';
  return prisma.user.create({
    data: {
      email: opts.email ?? fakeEmail(role),
      role,
      passwordHash: await hashPassword(opts.password ?? PASSWORD),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
}

/** TOTP for the current step, or `stepsAhead` periods in the future (to avoid replay rejection). */
export const totp = (secret: string, stepsAhead = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + stepsAhead * 30 });

export async function login(client: TestClient, email: string, password = PASSWORD) {
  return client.post('/api/auth/login', { email, password });
}

/** Logs in and enrols MFA through the API. Returns the secret and recovery codes. */
export async function enrolMfa(client: TestClient, email: string) {
  await login(client, email);
  const setup = await client.post('/api/auth/mfa/setup');
  const secret: string = setup.body.manualKey;
  const enabled = await client.post('/api/auth/mfa/enable', { code: await totp(secret) });
  return { secret, recoveryCodes: enabled.body.recoveryCodes as string[], setup, enabled };
}
