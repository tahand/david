import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasPermission, isStaffRole, type Permission } from '@clinic/shared';
import { AppError } from '../lib/errors.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  type AuthContext,
  type SessionStore,
} from '../modules/auth/sessions.js';

/** Attaches `req.auth` / `req.pendingAuth` from the session cookie. Never rejects. */
export function loadSession(sessions: SessionStore): RequestHandler {
  return async (req, res, next) => {
    try {
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      if (typeof token === 'string' && token.length > 0 && token.length < 200) {
        const ctx = await sessions.resolve(token);
        if (!ctx) clearSessionCookie(res);
        else if (ctx.session.mfaPending) req.pendingAuth = ctx;
        else req.auth = ctx;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const mfaEnrolmentRequired = (ctx: AuthContext): boolean =>
  isStaffRole(ctx.user.role) && !ctx.user.mfaEnabled;

/**
 * Requires a full session. Staff without MFA are confined to the enrolment
 * endpoints until they enrol (SPEC §4.1).
 */
export function requireAuth(opts: { allowMfaEnrolment?: boolean } = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(AppError.unauthenticated());
    if (!opts.allowMfaEnrolment && mfaEnrolmentRequired(req.auth)) {
      return next(
        new AppError(403, 'MFA_ENROLMENT_REQUIRED', 'Set up two-step verification to continue'),
      );
    }
    next();
  };
}

/** Central RBAC check (SPEC §3). Ownership checks still belong in services. */
export function authorize(permission: Permission): RequestHandler[] {
  return [
    requireAuth(),
    (req, _res, next) => {
      if (!hasPermission(req.auth!.user.role, permission)) return next(AppError.forbidden());
      next();
    },
  ];
}

/** Narrowing helper for handlers that run after requireAuth/authorize. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}
