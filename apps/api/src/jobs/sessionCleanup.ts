import type { PrismaClient } from '@prisma/client';
import { ROLES } from '@clinic/shared';
import { idleTimeoutMinutes } from '../modules/auth/sessions.js';

const MINUTE = 60_000;
/** Used or expired email tokens are kept a day for troubleshooting, then deleted. */
const TOKEN_GRACE_MS = 24 * 60 * MINUTE;

export interface CleanupResult {
  sessions: number;
  emailTokens: number;
  rateLimits: number;
}

/**
 * Deletes sessions that can no longer be used (past their absolute expiry, or
 * idle longer than any role's timeout), spent email tokens and expired
 * rate-limit counters. All three tables allow DELETE for app_user.
 */
export async function cleanupExpired(deps: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<CleanupResult> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const maxIdleMinutes = Math.max(...ROLES.map((role) => idleTimeoutMinutes({ role })));
  const idleBefore = new Date(now.getTime() - maxIdleMinutes * MINUTE);
  const tokensBefore = new Date(now.getTime() - TOKEN_GRACE_MS);

  const [sessions, emailTokens, rateLimits] = await Promise.all([
    prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { mfaPending: false, lastSeenAt: { lt: idleBefore } }],
      },
    }),
    prisma.emailToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: tokensBefore } }, { usedAt: { lt: tokensBefore } }] },
    }),
    prisma.rateLimit.deleteMany({ where: { expire: { lt: now } } }),
  ]);
  return { sessions: sessions.count, emailTokens: emailTokens.count, rateLimits: rateLimits.count };
}
