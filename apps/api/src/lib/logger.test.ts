import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { REDACT_PATHS } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
  return { logger, lines };
}

describe('logger redaction', () => {
  it('redacts credentials, tokens, session ids and medical data', () => {
    const { logger, lines } = capture();
    logger.info({
      password: 'hunter2hunter2',
      user: { passwordHash: 'argon2-hash-value', email: 'a@example.test' },
      req: { headers: { cookie: '__Host-sid=abc', 'x-csrf-token': 'csrf-value', host: 'x' } },
      patient: { details: { medicalSummary: { allergies: ['penicillin'] } } },
      token: 'reset-token',
    });
    const out = lines.join('');
    for (const secret of [
      'hunter2hunter2',
      'argon2-hash-value',
      '__Host-sid=abc',
      'csrf-value',
      'penicillin',
      'reset-token',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('a@example.test');
    expect(out).toContain('[REDACTED]');
  });
});
