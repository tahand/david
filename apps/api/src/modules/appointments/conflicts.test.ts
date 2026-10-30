import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { isOverlapViolation, isRetryableConflict } from './service.js';

const known = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
const unknown = (message: string) =>
  new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: 'test' });

describe('booking conflict classification', () => {
  it('recognises the no_overlap violation as "slot taken"', () => {
    expect(
      isOverlapViolation(
        unknown('23P01: conflicting key value violates exclusion constraint "no_overlap"'),
      ),
    ).toBe(true);
    expect(isRetryableConflict(unknown('violates exclusion constraint "no_overlap"'))).toBe(false);
  });

  it('treats deadlocks and write conflicts as retryable, not as server errors', () => {
    // Two simultaneous inserts into the exclusion constraint can deadlock (SPEC §15).
    expect(
      isRetryableConflict(
        known('P2034', 'Transaction failed due to a write conflict or a deadlock'),
      ),
    ).toBe(true);
    expect(isRetryableConflict(unknown('ERROR: deadlock detected (SQLSTATE 40P01)'))).toBe(true);
    expect(isRetryableConflict(unknown('could not serialize access (40001)'))).toBe(true);
    expect(isRetryableConflict(known('P2028', 'Transaction already closed'))).toBe(true);
    expect(isOverlapViolation(known('P2034', 'deadlock'))).toBe(false);
  });

  it('leaves other errors alone', () => {
    expect(isRetryableConflict(new Error('deadlock detected'))).toBe(false);
    expect(isRetryableConflict(known('P2002', 'Unique constraint failed'))).toBe(false);
  });
});
