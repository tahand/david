import { describe, expect, it } from 'vitest';
import { utcToZoned, weekdayOf, zonedToUtc } from './clinicTime.js';
import {
  computeSlots,
  mergeIntervals,
  workingPeriods,
  type AvailabilityException,
  type Interval,
  type SlotQuery,
  type WeeklyRule,
} from './slots.js';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';

/** A rule for the weekday of `date`, valid for any date. */
const ruleOn = (
  date: string,
  startTime: string,
  endTime: string,
  extra: Partial<WeeklyRule> = {},
) => ({
  weekday: weekdayOf(date),
  startTime,
  endTime,
  validFrom: '2000-01-01',
  validTo: null,
  ...extra,
});

const at = (local: string, tz = LONDON) => zonedToUtc(local, tz);
const span = (from: string, to: string, tz = LONDON): Interval => ({
  start: at(from, tz),
  end: at(to, tz),
});
const exception = (type: AvailabilityException['type'], from: string, to: string, tz = LONDON) => ({
  type,
  ...span(from, to, tz),
});

function slots(q: Partial<SlotQuery> & Pick<SlotQuery, 'from'>): Interval[] {
  return computeSlots({
    rules: [],
    exceptions: [],
    busy: [],
    to: q.from,
    timeZone: LONDON,
    durationMinutes: 15,
    ...q,
  });
}

/** Clinic-local "HH:MM" start times. */
const times = (result: Interval[], tz = LONDON) => result.map((s) => utcToZoned(s.start, tz).time);
const isoStarts = (result: Interval[]) => result.map((s) => s.start.toISOString());

// 2 Nov 2026 is a Monday (GMT); 6 Jul 2026 is a Monday (BST).
const WINTER = '2026-11-02';
const SUMMER = '2026-07-06';

describe('computeSlots: working hours', () => {
  it('fills a block with back-to-back slots of the appointment length', () => {
    const result = slots({ from: WINTER, rules: [ruleOn(WINTER, '09:00', '10:00')] });
    expect(times(result)).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(result[0]).toEqual(span(`${WINTER}T09:00`, `${WINTER}T09:15`));
  });

  it('applies the BST offset in summer', () => {
    const result = slots({ from: SUMMER, rules: [ruleOn(SUMMER, '09:00', '09:30')] });
    expect(isoStarts(result)).toEqual(['2026-07-06T08:00:00.000Z', '2026-07-06T08:15:00.000Z']);
  });

  it('supports several blocks a day, e.g. a lunch break', () => {
    const result = slots({
      from: WINTER,
      rules: [ruleOn(WINTER, '09:00', '09:30'), ruleOn(WINTER, '13:00', '13:30')],
    });
    expect(times(result)).toEqual(['09:00', '09:15', '13:00', '13:15']);
  });

  it('only uses rules for the right weekday', () => {
    const tuesday = '2026-11-03';
    const result = slots({ from: WINTER, to: tuesday, rules: [ruleOn(tuesday, '09:00', '09:15')] });
    expect(result.map((s) => utcToZoned(s.start, LONDON).date)).toEqual([tuesday]);
  });

  it('drops the tail of a block that is too short for another slot', () => {
    const result = slots({
      from: WINTER,
      rules: [ruleOn(WINTER, '09:00', '10:00')],
      durationMinutes: 25,
    });
    expect(times(result)).toEqual(['09:00', '09:25']);
  });

  it('offers nothing when a block is shorter than the appointment', () => {
    const result = slots({
      from: WINTER,
      rules: [ruleOn(WINTER, '09:00', '09:20')],
      durationMinutes: 30,
    });
    expect(result).toEqual([]);
  });

  it('treats touching or overlapping blocks as one period', () => {
    const result = slots({
      from: WINTER,
      rules: [ruleOn(WINTER, '09:00', '09:20'), ruleOn(WINTER, '09:20', '10:00')],
      durationMinutes: 30,
    });
    expect(times(result)).toEqual(['09:00', '09:30']);
  });

  it('can step more finely than the appointment length', () => {
    const result = slots({
      from: WINTER,
      rules: [ruleOn(WINTER, '09:00', '10:00')],
      durationMinutes: 30,
      stepMinutes: 15,
    });
    expect(times(result)).toEqual(['09:00', '09:15', '09:30']);
  });

  it('honours inclusive validFrom / validTo dates', () => {
    const nextWeek = '2026-11-09';
    const rules = [
      ruleOn(WINTER, '09:00', '09:15', { validTo: WINTER }),
      ruleOn(WINTER, '10:00', '10:15', { validFrom: nextWeek }),
    ];
    expect(times(slots({ from: WINTER, rules }))).toEqual(['09:00']);
    expect(times(slots({ from: nextWeek, rules }))).toEqual(['10:00']);
  });

  it('rejects a zero-length appointment', () => {
    expect(() => slots({ from: WINTER, durationMinutes: 0 })).toThrow();
  });
});

describe('computeSlots: appointments and exceptions', () => {
  const day = { from: WINTER, rules: [ruleOn(WINTER, '09:00', '10:00')] };

  it('removes slots that overlap an existing appointment, allowing back-to-back', () => {
    const result = slots({ ...day, busy: [span(`${WINTER}T09:15`, `${WINTER}T09:30`)] });
    expect(times(result)).toEqual(['09:00', '09:30', '09:45']);
  });

  it('removes every slot an off-grid appointment touches', () => {
    const result = slots({ ...day, busy: [span(`${WINTER}T09:10`, `${WINTER}T09:20`)] });
    expect(times(result)).toEqual(['09:30', '09:45']);
  });

  it('removes slots during partial time off', () => {
    const result = slots({
      ...day,
      exceptions: [exception('unavailable', `${WINTER}T09:30`, `${WINTER}T12:00`)],
    });
    expect(times(result)).toEqual(['09:00', '09:15']);
  });

  it('removes everything during time off spanning several days', () => {
    const result = slots({
      from: WINTER,
      to: '2026-11-04',
      rules: [1, 2, 3].map((weekday) => ({ ...ruleOn(WINTER, '09:00', '09:15'), weekday })),
      exceptions: [exception('unavailable', '2026-10-31T00:00', '2026-11-04T00:00')],
    });
    expect(result.map((s) => utcToZoned(s.start, LONDON).date)).toEqual(['2026-11-04']);
  });

  it('adds an extra session on a day with no regular hours', () => {
    const result = slots({
      from: WINTER,
      exceptions: [exception('extra', `${WINTER}T18:00`, `${WINTER}T18:30`)],
    });
    expect(times(result)).toEqual(['18:00', '18:15']);
  });

  it('merges an extra session that extends regular hours', () => {
    const result = slots({
      ...day,
      exceptions: [exception('extra', `${WINTER}T10:00`, `${WINTER}T10:30`)],
      durationMinutes: 30,
    });
    expect(times(result)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('lets time off win over an extra session', () => {
    const result = slots({
      from: WINTER,
      exceptions: [
        exception('extra', `${WINTER}T18:00`, `${WINTER}T19:00`),
        exception('unavailable', `${WINTER}T18:00`, `${WINTER}T18:30`),
      ],
    });
    expect(times(result)).toEqual(['18:30', '18:45']);
  });

  it('clips extra sessions to the requested dates', () => {
    const result = slots({
      from: WINTER,
      exceptions: [exception('extra', '2026-11-01T23:30', `${WINTER}T00:30`)],
    });
    expect(times(result)).toEqual(['00:00', '00:15']);
  });
});

describe('computeSlots: booking window', () => {
  const day = { from: WINTER, rules: [ruleOn(WINTER, '09:00', '10:00')] };

  it('drops slots before notBefore (minimum lead time)', () => {
    const result = slots({ ...day, notBefore: at(`${WINTER}T09:20`) });
    expect(times(result)).toEqual(['09:30', '09:45']);
  });

  it('keeps a slot starting exactly at notBefore', () => {
    expect(times(slots({ ...day, notBefore: at(`${WINTER}T09:30`) }))).toEqual(['09:30', '09:45']);
  });

  it('drops slots after notAfter (booking horizon)', () => {
    const result = slots({ ...day, notAfter: at(`${WINTER}T09:15`) });
    expect(times(result)).toEqual(['09:00', '09:15']);
  });
});

describe('computeSlots: DST in Europe/London', () => {
  const SPRING = '2026-03-29'; // Sunday; 01:00 GMT → 02:00 BST
  const AUTUMN = '2026-10-25'; // Sunday; 02:00 BST → 01:00 GMT

  it('uses GMT the day before and BST on the day clocks go forward', () => {
    const result = slots({
      from: '2026-03-28',
      to: SPRING,
      rules: [ruleOn('2026-03-28', '09:00', '09:15'), ruleOn(SPRING, '09:00', '09:15')],
    });
    expect(isoStarts(result)).toEqual(['2026-03-28T09:00:00.000Z', '2026-03-29T08:00:00.000Z']);
    expect(times(result)).toEqual(['09:00', '09:00']);
  });

  it('gives a block across the spring gap only its real length', () => {
    // 00:00–04:00 on the wall clock is 3 real hours.
    const result = slots({
      from: SPRING,
      rules: [ruleOn(SPRING, '00:00', '04:00')],
      durationMinutes: 60,
    });
    expect(times(result)).toEqual(['00:00', '02:00', '03:00']);
  });

  it('starts a block that begins inside the gap at the end of the gap', () => {
    // 01:00 doesn't exist; the block is 02:00–03:00 BST.
    const result = slots({
      from: SPRING,
      rules: [ruleOn(SPRING, '01:00', '03:00')],
      durationMinutes: 60,
    });
    expect(times(result)).toEqual(['02:00']);
    expect(isoStarts(result)).toEqual(['2026-03-29T01:00:00.000Z']);
  });

  it('gives a block across the autumn overlap its real length, repeating 01:00', () => {
    // 00:00–03:00 on the wall clock is 4 real hours.
    const result = slots({
      from: AUTUMN,
      rules: [ruleOn(AUTUMN, '00:00', '03:00')],
      durationMinutes: 60,
    });
    expect(isoStarts(result)).toEqual([
      '2026-10-24T23:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T01:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
    ]);
    expect(times(result)).toEqual(['00:00', '01:00', '01:00', '02:00']);
  });

  it('uses GMT after clocks go back', () => {
    const monday = '2026-10-26';
    const result = slots({
      from: '2026-10-24',
      to: monday,
      rules: [ruleOn('2026-10-24', '09:00', '09:15'), ruleOn(monday, '09:00', '09:15')],
    });
    expect(isoStarts(result)).toEqual(['2026-10-24T08:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  });

  it('keeps the requested range to whole clinic-local days on DST days', () => {
    // An extra session covering the whole of both days is clipped to local midnights.
    const result = slots({
      from: AUTUMN,
      exceptions: [exception('extra', '2026-10-24T00:00', '2026-10-27T00:00')],
      durationMinutes: 60,
    });
    expect(result).toHaveLength(25);
    expect(result[0]!.start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(result.at(-1)!.end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('computeSlots: DST in America/New_York', () => {
  it('follows the US change dates', () => {
    const result = slots({
      from: '2026-03-07',
      to: '2026-03-09',
      timeZone: NEW_YORK,
      rules: [0, 1, 6].map((weekday) => ({ ...ruleOn('2026-03-07', '09:00', '09:15'), weekday })),
    });
    expect(isoStarts(result)).toEqual([
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
    expect(times(result, NEW_YORK)).toEqual(['09:00', '09:00', '09:00']);
  });

  it('offers 23 hourly slots on the spring-forward day', () => {
    const result = slots({
      from: '2026-03-08',
      timeZone: NEW_YORK,
      exceptions: [exception('extra', '2026-03-08T00:00', '2026-03-09T00:00', NEW_YORK)],
      durationMinutes: 60,
    });
    expect(result).toHaveLength(23);
  });
});

describe('workingPeriods', () => {
  it('returns one UTC interval per matching rule and date', () => {
    expect(workingPeriods([ruleOn(WINTER, '09:00', '12:00')], WINTER, WINTER, LONDON)).toEqual([
      span(`${WINTER}T09:00`, `${WINTER}T12:00`),
    ]);
  });
});

describe('mergeIntervals', () => {
  const i = (a: string, b: string): Interval => ({
    start: new Date(`2026-01-01T${a}:00Z`),
    end: new Date(`2026-01-01T${b}:00Z`),
  });

  it('merges overlapping and touching intervals, sorted', () => {
    expect(
      mergeIntervals([
        i('11:00', '12:00'),
        i('09:00', '10:00'),
        i('10:00', '10:30'),
        i('09:30', '09:45'),
      ]),
    ).toEqual([i('09:00', '10:30'), i('11:00', '12:00')]);
  });

  it('drops empty intervals and does not mutate its input', () => {
    const input = [i('09:00', '10:00'), i('09:30', '11:00'), i('12:00', '12:00')];
    const copy = structuredClone(input);
    expect(mergeIntervals(input)).toEqual([i('09:00', '11:00')]);
    expect(input).toEqual(copy);
  });
});
