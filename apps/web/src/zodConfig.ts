import { z } from 'zod';

/**
 * Zod 4 probes `new Function` to compile faster validators. Our CSP forbids
 * eval (script-src 'self'), so the probe raises a CSP violation on every page.
 * Jitless mode skips the probe. Imported first in main.tsx, before any schema runs.
 */
z.config({ jitless: true });
