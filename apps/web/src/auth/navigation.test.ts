import { describe, expect, it } from 'vitest';
import { loginPathFor, safeNext } from './navigation';

describe('safeNext (open-redirect protection, SPEC §10)', () => {
  it.each(['/dashboard', '/patients/123?tab=notes', '/account/security#sessions'])(
    'allows %s',
    (p) => {
      expect(safeNext(p)).toBe(p);
    },
  );

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/\t/evil.example',
    'dashboard',
    '',
    null,
    '/login',
    '/login/mfa',
  ])('rejects %s', (p) => {
    expect(safeNext(p as string | null)).toBeNull();
  });

  it('builds the login redirect with an encoded next', () => {
    expect(loginPathFor({ pathname: '/dashboard', search: '?a=1' })).toBe(
      '/login?next=%2Fdashboard%3Fa%3D1',
    );
    expect(loginPathFor({ pathname: '/', search: '' })).toBe('/login');
  });
});
