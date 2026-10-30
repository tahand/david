import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  DOCUMENT_SECURITY_HEADERS,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
} from '@clinic/shared';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function nginxConfigs(dir = path.join(repoRoot, 'deploy')): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return nginxConfigs(full);
    return /nginx.*\.conf$/.test(name) ? [full] : [];
  });
}

/** Every value given to `add_header <name> "<value>"` in a config. */
const headerValues = (conf: string, name: string) =>
  [...conf.matchAll(new RegExp(`add_header\\s+${name}\\s+"([^"]*)"`, 'gi'))].map((m) => m[1]);

describe('security headers', () => {
  it('builds the CSP from the directives', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    expect(DOCUMENT_SECURITY_HEADERS['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
  });

  const configs = nginxConfigs();
  it('finds the Nginx configs', () => {
    expect(configs.length).toBeGreaterThan(0);
  });

  it.each(configs.map((c) => [path.relative(repoRoot, c), c]))(
    '%s sends the same headers as the API',
    (_name, file) => {
      const conf = readFileSync(file, 'utf8');
      const expected: [string, string][] = [
        ['Content-Security-Policy', CONTENT_SECURITY_POLICY],
        ['Referrer-Policy', REFERRER_POLICY],
        ['Permissions-Policy', PERMISSIONS_POLICY],
        ['X-Content-Type-Options', 'nosniff'],
      ];
      for (const [header, value] of expected) {
        const values = headerValues(conf, header);
        expect(values.length, `${header} is set`).toBeGreaterThan(0);
        for (const v of values) expect(v, header).toBe(value);
      }
    },
  );
});
