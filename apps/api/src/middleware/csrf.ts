import type { RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/tokens.js';

/**
 * Signed double-submit CSRF protection (SPEC §4.6).
 *
 * `GET /api/auth/csrf` sets an HttpOnly `__Host-csrf` cookie and returns the
 * same token in the body; the SPA keeps it in memory and echoes it in the
 * `X-CSRF-Token` header. Tokens are HMAC-signed so an attacker who can plant a
 * cookie (e.g. from a sibling subdomain) still cannot forge one. State-changing
 * requests must also carry an Origin (or Referer) matching APP_URL.
 */
export const CSRF_COOKIE = '__Host-csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(secret: Buffer): string {
  const nonce = randomToken(24);
  return `${nonce}.${hmacSha256(secret, nonce)}`;
}

export function isValidCsrfToken(secret: Buffer, token: string): boolean {
  const [nonce, sig, ...rest] = token.split('.');
  if (!nonce || !sig || rest.length > 0) return false;
  return safeEqual(sig, hmacSha256(secret, nonce));
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}

function originMatches(header: string | undefined, appOrigin: string): boolean {
  if (!header) return false;
  try {
    return new URL(header).origin === appOrigin;
  } catch {
    return false;
  }
}

export function csrfProtection(opts: { secret: Buffer; appOrigin: string }): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin') ?? req.get('referer');
    if (!originMatches(origin, opts.appOrigin)) {
      return next(new AppError(403, 'CSRF_INVALID', 'Request origin not allowed'));
    }

    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (
      typeof cookie !== 'string' ||
      !header ||
      !safeEqual(cookie, header) ||
      !isValidCsrfToken(opts.secret, header)
    ) {
      return next(
        new AppError(
          403,
          'CSRF_INVALID',
          'Invalid or missing CSRF token. Refresh the page and try again',
        ),
      );
    }
    next();
  };
}
