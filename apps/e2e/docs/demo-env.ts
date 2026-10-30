import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Throwaway database for documentation screenshots (dev Postgres container). */
export const DEMO_DATABASE_URL = 'postgresql://app_user:app_user_dev@127.0.0.1:5433/clinic_demo';
export const DEMO_MIGRATION_URL =
  'postgresql://app_migrator:app_migrator_dev@127.0.0.1:5433/clinic_demo';
/** Dev container superuser, used only to (re)create clinic_demo. */
export const DEV_SUPERUSER_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const GUIDE_DIR = path.join(REPO_ROOT, 'docs/user-guide');
export const GUIDE_IMAGES = path.join(GUIDE_DIR, 'images');
export const MARKETING_DIR = path.join(REPO_ROOT, 'docs/marketing');
/** Intermediate captures used to build the marketing composites (not committed). */
export const RAW_DIR = path.join(here, '.raw');
