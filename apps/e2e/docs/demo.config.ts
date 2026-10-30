import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_ENV, WEB_URL } from '../env';
import { DEMO_DATABASE_URL } from './demo-env';

/**
 * Generates the user guide (PDF) and marketing images from a freshly built
 * demo clinic. `npm run docs` from the repo root; needs `npm run db:up`.
 *
 * Uses its own database (clinic_demo), recreated on every run, so test data
 * and your local Docker stack are never touched.
 */
// The database must exist before the web servers start (Playwright starts them
// before globalSetup). Workers load this config too, so only prepare it once.
if (!process.env.CLINIC_DEMO_PREPARED) {
  const setup = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-setup.ts');
  execFileSync('npx', ['tsx', setup], { stdio: 'inherit', shell: process.platform === 'win32' });
  process.env.CLINIC_DEMO_PREPARED = '1';
}

export default defineConfig({
  testDir: '.',
  timeout: 10 * 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
  },
  projects: [
    { name: 'capture', testMatch: 'capture.spec.ts', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'publish',
      testMatch: 'publish.spec.ts',
      dependencies: ['capture'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx tsx --conditions=@clinic/source src/index.ts',
      cwd: '../../api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        ...E2E_ENV,
        DATABASE_URL: DEMO_DATABASE_URL,
        LOG_LEVEL: 'error',
        EMAIL_FROM: 'Maple Grove Clinic <no-reply@maplegrove.example>',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: 'npx vite build && npx vite preview',
      cwd: '../../web',
      url: `${WEB_URL}/login`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
    },
  ],
});
