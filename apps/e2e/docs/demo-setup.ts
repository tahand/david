import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  DEMO_MIGRATION_URL,
  DEV_SUPERUSER_URL,
  GUIDE_IMAGES,
  MARKETING_DIR,
  RAW_DIR,
  REPO_ROOT,
} from './demo-env';

/**
 * Recreates the clinic_demo database (its own, never shared with tests or the
 * local stack) and applies the migrations, so every run starts from the same
 * empty clinic.
 */
export default async function demoSetup() {
  const admin = new PrismaClient({ datasources: { db: { url: DEV_SUPERUSER_URL } } });
  try {
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS clinic_demo WITH (FORCE)');
    await admin.$executeRawUnsafe(`CREATE DATABASE clinic_demo OWNER app_migrator ENCODING 'UTF8'`);
    await admin.$executeRawUnsafe('REVOKE ALL ON DATABASE clinic_demo FROM PUBLIC');
    await admin.$executeRawUnsafe('GRANT CONNECT, TEMPORARY ON DATABASE clinic_demo TO app_user');
  } finally {
    await admin.$disconnect();
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.join(REPO_ROOT, 'apps/api'),
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: DEMO_MIGRATION_URL },
  });
  for (const dir of [GUIDE_IMAGES, MARKETING_DIR, RAW_DIR]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
}

// Run directly (from demo.config.ts, before the web servers start).
if (process.argv[1] && /demo-setup\.ts$/.test(process.argv[1])) {
  await demoSetup();
}
