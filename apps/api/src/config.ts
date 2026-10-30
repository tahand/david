import { z } from 'zod';

/** Accepts a base64 string that decodes to at least/exactly `bytes` bytes. */
const base64Bytes = (bytes: number, mode: 'exact' | 'min') =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64')
    .refine(
      (v) => {
        const len = Buffer.from(v, 'base64').length;
        return mode === 'exact' ? len === bytes : len >= bytes;
      },
      `must decode to ${mode === 'exact' ? 'exactly' : 'at least'} ${bytes} bytes`,
    );

const postgresUrl = z
  .url()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgresql:// URL');

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA timezone');

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Listen address. Loopback in production (Nginx is the entry point); 0.0.0.0 inside Docker. */
  HOST: z.union([z.ipv4(), z.ipv6()]).default('127.0.0.1'),
  APP_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: postgresUrl,
  MIGRATION_DATABASE_URL: postgresUrl.optional(),
  SESSION_SECRET: base64Bytes(64, 'min'),
  DATA_ENCRYPTION_KEY: base64Bytes(32, 'exact'),
  DATA_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1),
  CLINIC_TIMEZONE: timezone,
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(3),
  HIBP_CHECK_ENABLED: booleanString.default(true),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  host: string;
  appUrl: string;
  /** Origin derived from APP_URL, used for the Origin-header check (SPEC §4.6). */
  appOrigin: string;
  logLevel: Env['LOG_LEVEL'];
  databaseUrl: string;
  sessionSecret: Buffer;
  dataEncryptionKey: Buffer;
  dataEncryptionKeyVersion: number;
  clinicTimezone: string;
  smtp: { host: string; port: number; user?: string; pass?: string; from: string };
  hibpCheckEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate environment variables. Throws ConfigError listing every
 * problem so the process can fail fast at startup (SPEC §13). Values are never
 * included in the error message, only variable names.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as unset so `FOO=` in .env counts as missing.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const e = parsed.data;

  if (e.NODE_ENV === 'production' && !e.APP_URL.startsWith('https://')) {
    throw new ConfigError(['APP_URL: must use https in production']);
  }

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    host: e.HOST,
    appUrl: e.APP_URL,
    appOrigin: new URL(e.APP_URL).origin,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: Buffer.from(e.SESSION_SECRET, 'base64'),
    dataEncryptionKey: Buffer.from(e.DATA_ENCRYPTION_KEY, 'base64'),
    dataEncryptionKeyVersion: e.DATA_ENCRYPTION_KEY_VERSION,
    clinicTimezone: e.CLINIC_TIMEZONE,
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.EMAIL_FROM,
    },
    hibpCheckEnabled: e.HIBP_CHECK_ENABLED,
  };
}
