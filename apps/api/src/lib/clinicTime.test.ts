import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  timeColumnToString,
  timeStringToColumn,
  utcToZoned,
  weekdayOf,
  zonedToUtc,
  zonedToday,
} from './clinicTime.js';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const iso = (local: string, tz: string) => zonedToUtc(local, tz).toISOString();

describe('zonedToUtc', () => {
  it('converts GMT and BST wall-clock times', () => {
    expect(iso('2026-01-15T09:00', LONDON)).toBe('2026-01-15T09:00:00.000Z');
    expect(iso('2026-07-01T09:00', LONDON)).toBe('2026-07-01T08:00:00.000Z');
  });

  describe('UK spring forward (29 Mar 2026, 01:00 GMT → 02:00 BST)', () => {
    it('keeps times either side of the gap', () => {
      expect(iso('2026-03-29T00:59', LONDON)).toBe('2026-03-29T00:59:00.000Z');
      expect(iso('2026-03-29T02:00', LONDON)).toBe('2026-03-29T01:00:00.000Z');
    });

    it('moves skipped times forward by the gap', () => {
      expect(iso('2026-03-29T01:00', LONDON)).toBe('2026-03-29T01:00:00.000Z');
      expect(iso('2026-03-29T01:30', LONDON)).toBe('2026-03-29T01:30:00.000Z');
      expect(utcToZoned(zonedToUtc('2026-03-29T01:30', LONDON), LONDON).time).toBe('02:30');
    });
  });

  describe('UK fall back (25 Oct 2026, 02:00 BST → 01:00 GMT)', () => {
    it('resolves the repeated hour to its first (BST) occurrence', () => {
      expect(iso('2026-10-25T01:30', LONDON)).toBe('2026-10-25T00:30:00.000Z');
    });

    it('keeps times either side of the overlap', () => {
      expect(iso('2026-10-25T00:00', LONDON)).toBe('2026-10-24T23:00:00.000Z');
      expect(iso('2026-10-25T02:00', LONDON)).toBe('2026-10-25T02:00:00.000Z');
    });
  });

  it('handles US changes on different dates (8 Mar and 1 Nov 2026)', () => {
    expect(iso('2026-03-07T09:00', NEW_YORK)).toBe('2026-03-07T14:00:00.000Z');
    expect(iso('2026-03-08T09:00', NEW_YORK)).toBe('2026-03-08T13:00:00.000Z');
    // 02:30 doesn't exist; it becomes 03:30 EDT.
    expect(iso('2026-03-08T02:30', NEW_YORK)).toBe('2026-03-08T07:30:00.000Z');
    // 01:30 happens twice; the first is EDT.
    expect(iso('2026-11-01T01:30', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rejects malformed input and unknown zones', () => {
    expect(() => zonedToUtc('2026-13-45T99:00', LONDON)).toThrow();
    expect(() => zonedToUtc('2026-01-01T09:00', 'Mars/Olympus')).toThrow(/timezone/);
  });
});

describe('utcToZoned', () => {
  it('formats the clinic-local date and time', () => {
    expect(utcToZoned(new Date('2026-06-30T23:30:00Z'), LONDON)).toEqual({
      date: '2026-07-01',
      time: '00:30',
      dateTime: '2026-07-01T00:30',
    });
  });

  it('labels both occurrences of the repeated hour as 01:xx', () => {
    expect(utcToZoned(new Date('2026-10-25T00:30:00Z'), LONDON).time).toBe('01:30');
    expect(utcToZoned(new Date('2026-10-25T01:30:00Z'), LONDON).time).toBe('01:30');
  });
});

describe('calendar helpers', () => {
  it('adds days without DST drift', () => {
    expect(addCalendarDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addCalendarDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addCalendarDays('2026-10-25', -1)).toBe('2026-10-24');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('gives the weekday of a date (0 = Sunday)', () => {
    expect(weekdayOf('2026-03-29')).toBe(0);
    expect(weekdayOf('2026-11-02')).toBe(1);
  });

  it("gives today's date in the clinic zone, not the server's", () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST).
    expect(zonedToday(LONDON, new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    expect(zonedToday(NEW_YORK, new Date('2026-07-01T02:00:00Z'))).toBe('2026-06-30');
  });

  it('round-trips Prisma @db.Time values', () => {
    expect(timeColumnToString(timeStringToColumn('09:30'))).toBe('09:30');
  });
});
