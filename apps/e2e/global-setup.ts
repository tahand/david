import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAILPIT_URL, TEST_MIGRATION_DATABASE_URL } from './env';

/**
 * Applies pending migrations to the test database (never resets it: tests
 * create uniquely named rows) and checks Mailpit is up, since journeys read
 * real emails from it.
 */
export default async function globalSetup() {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: TEST_MIGRATION_DATABASE_URL },
  });
  try {
    const res = await fetch(`${MAILPIT_URL}/api/v1/info`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Mailpit is not reachable at ${MAILPIT_URL}; run \`npm run db:up\` (${String(err)})`,
    );
  }
}
