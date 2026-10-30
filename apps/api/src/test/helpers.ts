import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { PrismaClient } from '@prisma/client';
import { loadConfig, type Config } from '../config.js';
import { createApp, type AppDeps } from '../app.js';
import { MemoryMailer } from '../lib/email.js';
import { noBreachCheck } from '../lib/hibp.js';
import { MemoryRateLimiter } from '../lib/rateLimiter.js';

export const TEST_ORIGIN = 'http://localhost:5173';

export const validEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PORT: '4000',
  APP_URL: TEST_ORIGIN,
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

export const testConfig = (overrides: NodeJS.ProcessEnv = {}): Config =>
  loadConfig({ ...validEnv(), ...overrides });

/**
 * App wired with in-memory collaborators. The Prisma client never connects
 * unless a route queries the database, so DB-free tests can use this too.
 */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const config =
    overrides.config ??
    testConfig(overrides.prisma ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {});
  const mailer = new MemoryMailer();
  const deps: AppDeps = {
    config,
    logger: pino({ level: 'silent' }),
    prisma: new PrismaClient({ datasources: { db: { url: config.databaseUrl } } }),
    mailer,
    limiter: new MemoryRateLimiter(),
    isBreached: noBreachCheck,
    checkDb: async () => {},
    ...overrides,
  };
  return { app: createApp(deps), mailer: deps.mailer as MemoryMailer, deps };
}
