import type { AuthMeResponse, Role } from '@clinic/shared';

/**
 * Validates a post-login `next` value: same-origin relative paths only, to
 * prevent open redirects (SPEC §10). Returns null when unsafe.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  // Must be a single-slash path; rejects //evil.com, /\evil.com, javascript:, http://…
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  // Control characters and backslashes can be normalised into a scheme or host by browsers.
  for (const ch of next) {
    if (ch.charCodeAt(0) < 0x20 || ch === '\\') return null;
  }
  try {
    const base = 'https://app.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return null;
    if (url.pathname.startsWith('/login')) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Landing page per role. */
export const HOME_BY_ROLE: Record<Role, string> = {
  patient: '/dashboard',
  doctor: '/schedule',
  receptionist: '/front-desk',
  admin: '/admin/users',
};

/** Where a fully signed-in user should go, honouring a safe `next`. */
export function destinationFor(me: AuthMeResponse, next: string | null): string {
  if (me.user.mfaEnrolmentRequired) return '/mfa/setup';
  return safeNext(next) ?? HOME_BY_ROLE[me.user.role];
}

export function loginPathFor(
  location: { pathname: string; search: string } | null,
  reason?: string,
): string {
  const params = new URLSearchParams();
  const next = location ? safeNext(location.pathname + location.search) : null;
  if (next && next !== '/') params.set('next', next);
  if (reason) params.set('reason', reason);
  const q = params.toString();
  return q ? `/login?${q}` : '/login';
}
