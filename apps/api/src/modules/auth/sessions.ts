import type { PrismaClient, Session, User } from '@prisma/client';
import type { Response } from 'express';
import { isStaffRole } from '@clinic/shared';
import { randomToken, sha256 } from '../../lib/tokens.js';

/** SPEC §4.3. */
export const SESSION_COOKIE = '__Host-sid';
export const IDLE_TIMEOUT_MINUTES = { staff: 30, patient: 60 } as const;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const MFA_PENDING_TIMEOUT_MS = 5 * 60 * 1000;
/** lastSeenAt is written at most this often to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface AuthContext {
  session: Session;
  user: User;
}

export const idleTimeoutMinutes = (user: Pick<User, 'role'>): number =>
  isStaffRole(user.role) ? IDLE_TIMEOUT_MINUTES.staff : IDLE_TIMEOUT_MINUTES.patient;

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export class SessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates a session; only the SHA-256 of the returned token is stored. */
  async create(userId: string, opts: SessionMeta & { mfaPending: boolean }) {
    const token = randomToken(32);
    const ttl = opts.mfaPending ? MFA_PENDING_TIMEOUT_MS : ABSOLUTE_TIMEOUT_MS;
    const session = await this.prisma.session.create({
      data: {
        idHash: sha256(token),
        userId,
        mfaPending: opts.mfaPending,
        ip: opts.ip,
        userAgent: opts.userAgent?.slice(0, 500) ?? null,
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    return { token, session };
  }

  /**
   * Resolves a cookie token to a live session, enforcing absolute and idle
   * timeouts. Expired or orphaned sessions are deleted.
   */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { idHash: sha256(token) },
      include: { user: true },
    });
    if (!session) return null;
    const { user, ...bare } = session;
    const now = Date.now();
    const idleMs = idleTimeoutMinutes(user) * 60 * 1000;
    const expired =
      session.expiresAt.getTime() <= now ||
      (!session.mfaPending && now - session.lastSeenAt.getTime() > idleMs) ||
      !user.isActive ||
      user.deletedAt !== null;
    if (expired) {
      await this.destroy(session.id);
      return null;
    }
    if (!session.mfaPending && now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      bare.lastSeenAt = new Date(now);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: bare.lastSeenAt },
      });
    }
    return { session: bare, user };
  }

  async destroy(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async destroyAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    });
    return count;
  }

  /** Issues a fresh ID for the same user (SPEC §4.3 rotation) and drops the old one. */
  async rotate(old: Session, meta: SessionMeta) {
    const next = await this.create(old.userId, { ...meta, mfaPending: false });
    await this.destroy(old.id);
    return next;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  // __Host- prefix requires Secure, Path=/ and no Domain. Browsers accept
  // Secure cookies on http://localhost, so this also works in development.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}
