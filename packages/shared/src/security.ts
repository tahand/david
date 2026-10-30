/**
 * Security headers (SPEC §11): the single source of truth. The API applies
 * them with helmet, `vite preview` sends them for end-to-end tests, and a unit
 * test checks every Nginx config in deploy/ sends the same values.
 */

/** CSP directives in helmet's camelCase form. */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
} as const satisfies Record<string, readonly string[]>;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The CSP as a header value, e.g. `default-src 'self'; script-src 'self'; …`. */
export const CONTENT_SECURITY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${kebab(name)} ${values.join(' ')}`)
  .join('; ');

export const HSTS = { maxAge: 31_536_000, includeSubDomains: true } as const;
export const HSTS_HEADER = `max-age=${HSTS.maxAge}; includeSubDomains`;
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

/**
 * Headers for HTML responses (the SPA). HSTS is left to the TLS-terminating
 * server in production, since it is meaningless over plain http.
 */
export const DOCUMENT_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': REFERRER_POLICY,
  'Permissions-Policy': PERMISSIONS_POLICY,
};
