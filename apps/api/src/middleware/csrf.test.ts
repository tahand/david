import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidCsrfToken, issueCsrfToken } from './csrf.js';
import { generateRecoveryCode } from '../lib/tokens.js';

describe('CSRF token signing', () => {
  const secret = randomBytes(64);

  it('validates its own tokens and rejects tampered or foreign ones', () => {
    const token = issueCsrfToken(secret);
    expect(isValidCsrfToken(secret, token)).toBe(true);
    expect(isValidCsrfToken(secret, `${token}x`)).toBe(false);
    expect(isValidCsrfToken(randomBytes(64), token)).toBe(false);
    expect(isValidCsrfToken(secret, 'no-dot')).toBe(false);
    expect(isValidCsrfToken(secret, 'a.b.c')).toBe(false);
  });
});

describe('recovery codes', () => {
  it('are 10 base32 characters shown as xxxxx-xxxxx', () => {
    const { display, normalised } = generateRecoveryCode();
    expect(display).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(normalised).toBe(display.replace('-', ''));
  });
});
