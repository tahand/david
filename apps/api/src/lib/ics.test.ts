import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsDateTime } from './ics.js';

const base = {
  uid: 'abc@clinic.example',
  sequence: 3,
  method: 'REQUEST' as const,
  start: new Date('2026-11-02T09:00:00Z'),
  end: new Date('2026-11-02T09:15:00Z'),
  summary: 'Appointment with Dr Able',
  location: '1 Example Street, Exampletown',
  description: 'Line one\nLine two; with, punctuation \\ backslash',
  url: 'https://clinic.example/appointments',
  now: new Date('2026-10-30T12:34:56.789Z'),
};

describe('ics', () => {
  it('formats UTC date-times', () => {
    expect(icsDateTime(new Date('2026-03-29T01:30:00.123Z'))).toBe('20260329T013000Z');
  });

  it('escapes TEXT values', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(60)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(
      `DESCRIPTION:${'é'.repeat(60)}`,
    );
  });

  it('builds a request with CRLF line endings', () => {
    const ics = buildIcs(base);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n')).toEqual(
      expect.arrayContaining([
        'METHOD:REQUEST',
        'UID:abc@clinic.example',
        'SEQUENCE:3',
        'DTSTAMP:20261030T123456Z',
        'DTSTART:20261102T090000Z',
        'DTEND:20261102T091500Z',
        'LOCATION:1 Example Street\\, Exampletown',
        'STATUS:CONFIRMED',
      ]),
    );
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\; with\\, punctuation \\\\ backslash');
  });

  it('marks cancellations', () => {
    const ics = buildIcs({ ...base, method: 'CANCEL' });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
  });
});
