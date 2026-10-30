import argon2 from 'argon2';

/** Argon2id parameters from SPEC §4.2 (OWASP minimums: 19 MiB, t=2, p=1). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash: treat as a mismatch rather than a server error.
    return false;
  }
}
