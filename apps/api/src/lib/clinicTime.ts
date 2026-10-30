import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';

/**
 * Clinic-timezone conversions (SPEC §7.2). Calendar dates and wall-clock times
 * are plain strings ("2026-11-03", "09:00") so nothing depends on the server's
 * local timezone.
 */

const HOUR = 3_600_000;

/**
 * Wall-clock "YYYY-MM-DDTHH:MM" in `timeZone` → UTC instant, with the same
 * rules as Temporal's "compatible" disambiguation:
 * - a time skipped when clocks go forward moves forward by the gap
 *   (01:30 on the UK spring-forward day → 02:30 BST);
 * - a time that happens twice when clocks go back resolves to the first
 *   occurrence (01:30 on the UK fall-back day → 01:30 BST).
 *
 * date-fns-tz's `fromZonedTime` resolves skipped times backwards, which would
 * make e.g. a 00:00–01:00 block on the spring-forward day zero length.
 */
export function zonedToUtc(localDateTime: string, timeZone: string): Date {
  const wall = Date.parse(`${localDateTime}:00Z`);
  if (Number.isNaN(wall)) throw new Error(`Invalid local date-time: ${localDateTime}`);
  // DST changes are months apart, so the offsets 12 h either side are the only candidates.
  const before = getTimezoneOffset(timeZone, new Date(wall - 12 * HOUR));
  const after = getTimezoneOffset(timeZone, new Date(wall + 12 * HOUR));
  if (Number.isNaN(before) || Number.isNaN(after)) throw new Error(`Unknown timezone: ${timeZone}`);

  const matches = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((t) => formatInTimeZone(t, timeZone, "yyyy-MM-dd'T'HH:mm") === localDateTime)
    .sort((a, b) => a - b);
  // No match means the time fell in a gap: read it with the pre-change offset.
  return new Date(matches[0] ?? wall - before);
}

/** UTC instant → clinic-local date, time and "YYYY-MM-DDTHH:MM". */
export function utcToZoned(instant: Date, timeZone: string) {
  const dateTime = formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm");
  return { date: dateTime.slice(0, 10), time: dateTime.slice(11), dateTime };
}

/** Today's date in `timeZone`. */
export const zonedToday = (timeZone: string, now: Date = new Date()): string =>
  formatInTimeZone(now, timeZone, 'yyyy-MM-dd');

/**
 * Calendar arithmetic on "YYYY-MM-DD" strings in pure UTC. Not date-fns
 * `addDays`: it works in the server's local zone, so on a UK machine adding a
 * day to 29 March at UTC midnight lands on 23:00 UTC the same date.
 */
export function addCalendarDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${date}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a "YYYY-MM-DD" date. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Prisma maps `@db.Time` columns to Dates on 1970-01-01 UTC. */
export const timeColumnToString = (value: Date): string => value.toISOString().slice(11, 16);
export const timeStringToColumn = (value: string): Date => new Date(`1970-01-01T${value}:00Z`);

/** Prisma maps `@db.Date` columns to Dates at UTC midnight. */
export const dateColumnToString = (value: Date): string => value.toISOString().slice(0, 10);
export const dateStringToColumn = (value: string): Date => new Date(`${value}T00:00:00Z`);
