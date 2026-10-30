import { CONTENT_SECURITY_POLICY } from '../../../packages/shared/src/security';
import { expect, expectAccessible, expectNoHorizontalScroll, test } from './support';

/** Helmet omits the space after ';'; compare directive by directive. */
const directives = (csp = '') =>
  csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

test.describe('security headers (SPEC §11)', () => {
  test('the app and the API send the production headers', async ({ request }) => {
    const page = await request.get('/login');
    expect(directives(page.headers()['content-security-policy'])).toEqual(
      directives(CONTENT_SECURITY_POLICY),
    );
    expect(page.headers()['x-content-type-options']).toBe('nosniff');
    expect(page.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(page.headers()['permissions-policy']).toContain('camera=()');

    const api = await request.get('/api/health');
    expect(api.ok()).toBe(true);
    expect(directives(api.headers()['content-security-policy'])).toEqual(
      directives(CONTENT_SECURITY_POLICY),
    );
    expect(api.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(api.headers()['x-powered-by']).toBeUndefined();
  });

  test('the API refuses cross-site writes', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { Origin: 'https://evil.example' },
      data: { email: 'a@example.test', password: 'x' },
    });
    expect(res.status()).toBe(403);
  });
});

for (const path of ['/login', '/register', '/forgot-password', '/privacy']) {
  test(`${path} is accessible and fits a phone @phone`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page, path);
    await expectNoHorizontalScroll(page);
  });
}

test('keyboard-only sign-in form @phone', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  // Tab order reaches the fields and the button without a mouse.
  const focused: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    focused.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('autocomplete') ??
          document.activeElement?.textContent?.trim() ??
          '',
      ),
    );
  }
  expect(focused).toContain('username');
  expect(focused).toContain('current-password');
  expect(focused).toContain('Sign in');
});
