import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { createHibpChecker } from './hibp.js';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();

function fakeFetch(body: string, status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, { status }),
  );
}

describe('HIBP k-anonymity check', () => {
  const logger = pino({ level: 'silent' });

  it('sends only the 5-char prefix and detects a match', async () => {
    const hash = sha1('password123456');
    const fetchImpl = fakeFetch(`0000000000000000000000000000000000A:3\r\n${hash.slice(5)}:42\r\n`);
    const check = createHibpChecker({ logger, fetchImpl });
    expect(await check('password123456')).toBe(true);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(url).not.toContain(hash.slice(5));
  });

  it('ignores padding entries with a zero count', async () => {
    const hash = sha1('padded password');
    const check = createHibpChecker({ logger, fetchImpl: fakeFetch(`${hash.slice(5)}:0\n`) });
    expect(await check('padded password')).toBe(false);
  });

  it('fails open with a warning when the API is down', async () => {
    const warn = vi.fn();
    const log = { warn } as unknown as typeof logger;
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await createHibpChecker({ logger: log, fetchImpl: failing })('anything at all')).toBe(
      false,
    );
    expect(
      await createHibpChecker({ logger: log, fetchImpl: fakeFetch('', 503) })('anything'),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
