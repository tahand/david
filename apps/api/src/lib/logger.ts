import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Fields that must never reach the logs (SPEC §11): credentials, tokens,
 * session identifiers and patient medical data. Pino wildcards match a single
 * level, so common nesting depths are listed explicitly.
 */
const SENSITIVE_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'password_hash',
  'token',
  'recoveryCode',
  'secret',
  'mfaSecret',
  'sessionId',
  'sid',
  'healthId',
  'medicalSummary',
  'emergencyContact',
  'reasonForVisit',
  'noteBody',
  'mfaCode',
];

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];

export function createLogger(options: { level: string; pretty?: boolean } & LoggerOptions): Logger {
  const { pretty, ...rest } = options;
  return pino({
    ...rest,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
