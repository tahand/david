import { defineConfig } from 'vitest/config';

// Integration tests that need PostgreSQL (`npm run db:up`). The global setup
// resets clinic_test as app_migrator; tests then connect as app_user.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://app_user:app_user_dev@127.0.0.1:5433/clinic_test';
export const TEST_MIGRATION_DATABASE_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  'postgresql://app_migrator:app_migrator_dev@127.0.0.1:5433/clinic_test';

export default defineConfig({
  resolve: { conditions: ['@clinic/source'] },
  ssr: { resolve: { conditions: ['@clinic/source'] } },
  test: {
    include: ['src/**/*.db.test.ts'],
    environment: 'node',
    globalSetup: ['src/test/db-global-setup.ts'],
    env: { TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL },
    // Files share one database; tests isolate themselves with unique rows.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
