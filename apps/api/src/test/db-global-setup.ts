import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_MIGRATION_DATABASE_URL } from '../../vitest.db.config.js';

/**
 * Applies any pending migrations to the test database once per run. This is
 * deliberately non-destructive: tests create uniquely named rows, so leftover
 * data from earlier runs is harmless. To start from scratch, reset clinic_test
 * yourself (see README "Test database").
 */
export default function setup() {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: TEST_MIGRATION_DATABASE_URL },
  });
}
