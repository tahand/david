import { describe, expect, it } from 'vitest';
import { assertPasswordAcceptable } from './passwordPolicy.js';
import { noBreachCheck } from './hibp.js';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from './password.js';

describe('password policy (SPEC §4.2)', () => {
  const email = 'jamie.example@example.test';

  it('accepts a long passphrase with no composition rules', async () => {
    await expect(
      assertPasswordAcceptable('all lowercase words here', email, noBreachCheck),
    ).resolves.toBeUndefined();
  });

  it('enforces 12–128 characters', async () => {
    await expect(
      assertPasswordAcceptable('elevenchars', email, noBreachCheck),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      assertPasswordAcceptable('a'.repeat(129), email, noBreachCheck),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      assertPasswordAcceptable('a'.repeat(128), email, noBreachCheck),
    ).resolves.toBeUndefined();
  });

  it('rejects passwords containing the email or its local part', async () => {
    await expect(
      assertPasswordAcceptable(`x${email.toUpperCase()}x`, email, noBreachCheck),
    ).rejects.toThrow();
    await expect(
      assertPasswordAcceptable('jamie.example2026!', email, noBreachCheck),
    ).rejects.toThrow();
  });

  it('rejects breached passwords and reports the field', async () => {
    const err = await assertPasswordAcceptable(
      'breached but long',
      email,
      async () => true,
      'newPassword',
    ).catch((e) => e);
    expect(err.details[0]).toMatchObject({
      path: 'newPassword',
      message: expect.stringMatching(/breach/),
    });
  });
});

describe('Argon2id hashing', () => {
  it('uses the SPEC parameters', async () => {
    expect(ARGON2_OPTIONS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const hash = await hashPassword('a long test passphrase');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'a long test passphrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
