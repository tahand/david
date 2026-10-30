import { addCalendarDays, weekdayOf, zonedToUtc } from './clinicTime.js';

/**
 * Bookable slot computation (SPEC §7.1): weekly working hours plus "extra"
 * sessions, minus time off and existing appointments. Pure: no I/O, no clock,
 * so it can be tested exhaustively, including across DST changes.
 */

export interface WeeklyRule {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Wall-clock "HH:MM" in the clinic timezone. */
  startTime: string;
  endTime: string;
  /** Inclusive clinic-local dates ("YYYY-MM-DD"); validTo null = open-ended. */
  validFrom: string;
  validTo: string | null;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface AvailabilityException extends Interval {
  type: 'unavailable' | 'extra';
}

export interface SlotQuery {
  rules: WeeklyRule[];
  exceptions: AvailabilityException[];
  /** Existing appointments that hold the doctor's time. */
  busy: Interval[];
  /** Inclusive clinic-local dates. */
  from: string;
  to: string;
  timeZone: string;
  durationMinutes: number;
  /** Grid spacing from the start of each working period; defaults to the duration. */
  stepMinutes?: number;
  /** Drop slots starting before this instant (e.g. now + minimum lead time). */
  notBefore?: Date;
  /** Drop slots starting after this instant (e.g. the booking horizon). */
  notAfter?: Date;
}

const MINUTE = 60_000;

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) {
      if (next.end > last.end) last.end = next.end;
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

/** Clinic-local working periods for each date in [from, to], as UTC intervals. */
export function workingPeriods(
  rules: WeeklyRule[],
  from: string,
  to: string,
  timeZone: string,
): Interval[] {
  const periods: Interval[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      if (date < rule.validFrom || (rule.validTo !== null && date > rule.validTo)) continue;
      periods.push({
        start: zonedToUtc(`${date}T${rule.startTime}`, timeZone),
        end: zonedToUtc(`${date}T${rule.endTime}`, timeZone),
      });
    }
  }
  return periods;
}

/**
 * Returns slot start/end instants, sorted and unique.
 *
 * Slots sit on a grid that starts at the beginning of each merged working
 * period and advances in real elapsed time, so a period that crosses a DST
 * change still yields evenly spaced slots. A slot is offered only if it fits
 * entirely inside the period and overlaps no time off or appointment.
 */
export function computeSlots(q: SlotQuery): Interval[] {
  const duration = q.durationMinutes * MINUTE;
  const step = (q.stepMinutes ?? q.durationMinutes) * MINUTE;
  if (duration <= 0 || step <= 0) throw new Error('duration and step must be positive');

  const range: Interval = {
    start: zonedToUtc(`${q.from}T00:00`, q.timeZone),
    end: zonedToUtc(`${addCalendarDays(q.to, 1)}T00:00`, q.timeZone),
  };
  const clip = (i: Interval): Interval => ({
    start: i.start < range.start ? range.start : i.start,
    end: i.end > range.end ? range.end : i.end,
  });

  const open = mergeIntervals(
    [
      ...workingPeriods(q.rules, q.from, q.to, q.timeZone),
      ...q.exceptions.filter((e) => e.type === 'extra'),
    ].map(clip),
  );
  const blocked = mergeIntervals([
    ...q.exceptions.filter((e) => e.type === 'unavailable'),
    ...q.busy,
  ]);

  const slots: Interval[] = [];
  for (const period of open) {
    for (let t = period.start.getTime(); t + duration <= period.end.getTime(); t += step) {
      const slot = { start: new Date(t), end: new Date(t + duration) };
      if (q.notBefore && slot.start < q.notBefore) continue;
      if (q.notAfter && slot.start > q.notAfter) continue;
      if (blocked.some((b) => overlaps(b, slot))) continue;
      slots.push(slot);
    }
  }
  return slots;
}
