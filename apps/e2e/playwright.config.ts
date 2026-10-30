import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_ENV, WEB_URL } from './env';

/**
 * End-to-end tests (SPEC §14 phase 10). Starts its own API on the test
 * database plus a production build served by `vite preview` with production
 * security headers. Needs `npm run db:up` (Postgres + Mailpit).
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    locale: 'en-GB',
    // Clinic time, so dates in the UI match what tests compute.
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      // SPEC/CLAUDE.md: every screen must work on a 360px-wide phone.
      name: 'phone',
      grep: /@phone/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx --conditions=@clinic/source src/index.ts',
      cwd: '../api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: E2E_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite build && npx vite preview',
      cwd: '../web',
      url: `${WEB_URL}/login`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
    },
  ],
});
