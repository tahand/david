/**
 * Environment for the API instance the e2e run starts. Test-only values: the
 * keys below protect nothing but throwaway rows in the test database.
 */
export const API_PORT = 4100;
export const WEB_URL = 'http://localhost:4173';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://app_user:app_user_dev@127.0.0.1:5433/clinic_test';
export const TEST_MIGRATION_DATABASE_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  'postgresql://app_migrator:app_migrator_dev@127.0.0.1:5433/clinic_test';

export const E2E_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(API_PORT),
  APP_URL: WEB_URL,
  LOG_LEVEL: 'warn',
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: Buffer.alloc(64, 'e2e-session-secret').toString('base64'),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 'e2e-data-key').toString('base64'),
  DATA_ENCRYPTION_KEY_VERSION: '1',
  CLINIC_TIMEZONE: 'Europe/London',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  EMAIL_FROM: 'Clinic <no-reply@example.test>',
  HIBP_CHECK_ENABLED: 'false',
};
