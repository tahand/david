import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { loadConfig, type Config } from '../config.js';
import { createApp } from '../app.js';
import type { DbCheck } from '../modules/health/routes.js';

export const validEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PORT: '4000',
  APP_URL: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://app_user:pw@127.0.0.1:5432/clinic_test',
  SESSION_SECRET: randomBytes(64).toString('base64'),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DATA_ENCRYPTION_KEY_VERSION: '1',
  CLINIC_TIMEZONE: 'Europe/London',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  EMAIL_FROM: 'Clinic <no-reply@example.test>',
  HIBP_CHECK_ENABLED: 'false',
});

export const testConfig = (): Config => loadConfig(validEnv());

export function buildTestApp(opts: { checkDb?: DbCheck } = {}) {
  return createApp({
    config: testConfig(),
    logger: pino({ level: 'silent' }),
    checkDb: opts.checkDb ?? (async () => {}),
  });
}
