import { passwordSchema } from '@clinic/shared';
import { AppError } from './errors.js';
import type { BreachChecker } from './hibp.js';

/**
 * Server-side password rules beyond length (SPEC §4.2). Throws a
 * VALIDATION_ERROR shaped like a Zod failure on `field`.
 */
export async function assertPasswordAcceptable(
  password: string,
  email: string,
  isBreached: BreachChecker,
  field = 'password',
): Promise<void> {
  const fail = (message: string) =>
    new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: field, message }]);

  const length = passwordSchema.safeParse(password);
  if (!length.success) throw fail(length.error.issues[0]?.message ?? 'Invalid password');

  const lower = password.toLowerCase();
  const localPart = email.toLowerCase().split('@')[0] ?? '';
  if (lower.includes(email.toLowerCase()) || (localPart.length >= 4 && lower.includes(localPart))) {
    throw fail('Your password must not contain your email address');
  }

  if (await isBreached(password)) {
    throw fail('This password has appeared in a data breach. Choose a different one');
  }
}
