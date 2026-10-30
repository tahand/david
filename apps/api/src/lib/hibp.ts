import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export type BreachChecker = (password: string) => Promise<boolean>;

/**
 * HaveIBeenPwned k-anonymity range check (SPEC §4.2): only the first five hex
 * characters of the SHA-1 leave the server. Fails open (returns false) when the
 * API is unreachable, logging a warning.
 */
export function createHibpChecker(opts: {
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): BreachChecker {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (password) => {
    const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    try {
      const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'clinic-appointments' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
      if (!res.ok) throw new Error(`HIBP responded ${res.status}`);
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':');
        // Padding entries have a count of 0.
        return candidate === suffix && Number(count) > 0;
      });
    } catch (err) {
      opts.logger.warn({ err }, 'breached-password check unavailable; failing open');
      return false;
    }
  };
}

export const noBreachCheck: BreachChecker = async () => false;
