import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for session IDs and email tokens. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Only hashes of tokens are stored (SPEC §4.3). */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (key: Buffer, value: string): string =>
  createHmac('sha256', key).update(value).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 10 base32 characters (50 bits) shown to the user as `xxxxx-xxxxx`. */
export function generateRecoveryCode(): { display: string; normalised: string } {
  const bytes = randomBytes(10);
  let code = '';
  for (const b of bytes) code += BASE32[b & 31];
  return { display: `${code.slice(0, 5)}-${code.slice(5)}`, normalised: code };
}
