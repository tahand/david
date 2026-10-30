import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCipher } from './crypto.js';

const key1 = randomBytes(32);
const key2 = randomBytes(32);

describe('FieldCipher (AES-256-GCM)', () => {
  const cipher = FieldCipher.single(1, key1);

  it('round-trips and embeds the key version', () => {
    const env = cipher.encrypt('NHS 943 476 5919', 'patients.health_id:abc');
    expect(env).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(env).not.toContain('943');
    expect(cipher.decrypt(env, 'patients.health_id:abc')).toBe('NHS 943 476 5919');
  });

  it('uses a fresh IV per encryption', () => {
    expect(cipher.encrypt('same', 'a')).not.toBe(cipher.encrypt('same', 'a'));
  });

  it('rejects ciphertext moved to another row (AAD mismatch)', () => {
    const env = cipher.encrypt('secret', 'users.mfa_secret:user-1');
    expect(() => cipher.decrypt(env, 'users.mfa_secret:user-2')).toThrow();
  });

  it('detects tampering', () => {
    const env = cipher.encrypt('secret', 'a');
    const parts = env.split(':');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 1;
    parts[3] = ct.toString('base64');
    expect(() => cipher.decrypt(parts.join(':'), 'a')).toThrow();
  });

  it('decrypts old versions after key rotation and flags them', () => {
    const old = cipher.encrypt('legacy', 'a');
    const rotated = new FieldCipher(
      2,
      new Map([
        [1, key1],
        [2, key2],
      ]),
    );
    expect(rotated.decrypt(old, 'a')).toBe('legacy');
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('new', 'a'))).toBe(false);
  });

  it('rejects malformed envelopes, unknown versions and bad keys', () => {
    expect(() => cipher.decrypt('garbage', 'a')).toThrow(/Malformed/);
    expect(() => cipher.decrypt('v9:a:b:c', 'a')).toThrow(/Unknown/);
    expect(() => FieldCipher.single(1, randomBytes(16))).toThrow(/32 bytes/);
  });
});
