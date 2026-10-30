#!/usr/bin/env node
// Runs the Prisma CLI as the schema owner (app_migrator) rather than app_user
// (SPEC §8). Usage: node scripts/prisma-migrator.mjs migrate deploy
//
// Reads MIGRATION_DATABASE_URL from the environment, falling back to the repo
// root .env in development. In production systemd/deploy.sh supplies the env.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, '../../../.env');
if (!process.env.MIGRATION_DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  process.stderr.write('MIGRATION_DATABASE_URL is not set\n');
  process.exit(1);
}

const result = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  cwd: path.resolve(here, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
