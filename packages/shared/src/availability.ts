import { z } from 'zod';

/**
 * Doctor availability and slots (SPEC §7.1). Wall-clock values ("09:00",
 * "2026-11-03T09:00") are in the clinic timezone; instants in responses are
 * UTC ISO strings, with clinic-local copies for display.
 */

/** 0 = Sunday … 6 = Saturday, matching JS Date#getDay. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** Display order for the UK: Monday first. */
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const MAX_SLOT_RANGE_DAYS = 31;

/** "HH:MM", 00:00–23:59. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:MM');

const isRealDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** "YYYY-MM-DDTHH:MM" in the clinic timezone (what `<input type="datetime-local">` produces). */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Enter a date and time')
  .refine((v) => isRealDate(Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10))), {
    message: 'Enter a real date',
  });

export const calendarDateSchema = z.iso.date({ message: 'Enter a valid date' });

export const availabilityBlockSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .refine((b) => b.endTime > b.startTime, {
    path: ['endTime'],
    message: 'End time must be after the start time',
  });
export type AvailabilityBlock = z.output<typeof availabilityBlockSchema>;

/** PUT /doctors/:id/availability — replaces the weekly schedule. */
export const availabilityUpdateSchema = z
  .object({ rules: z.array(availabilityBlockSchema).max(50) })
  .superRefine(({ rules }, ctx) => {
    // Blocks on the same weekday must not overlap (touching is fine).
    rules.forEach((a, i) => {
      const clash = rules.some(
        (b, j) =>
          j < i && b.weekday === a.weekday && a.startTime < b.endTime && b.startTime < a.endTime,
      );
      if (clash) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', i, 'startTime'],
          message: 'Overlaps other hours on the same day',
        });
      }
    });
  });
export type AvailabilityUpdateInput = z.input<typeof availabilityUpdateSchema>;

export const EXCEPTION_TYPES = ['unavailable', 'extra'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** POST /doctors/:id/exceptions — time off, or a one-off extra session. */
export const exceptionCreateSchema = z
  .object({
    type: z.enum(EXCEPTION_TYPES),
    startsAt: localDateTimeSchema,
    endsAt: localDateTimeSchema,
    reason: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((e) => e.endsAt > e.startsAt, {
    path: ['endsAt'],
    message: 'End must be after the start',
  })
  .refine((e) => daysBetween(e.startsAt.slice(0, 10), e.endsAt.slice(0, 10)) <= 366, {
    path: ['endsAt'],
    message: 'An exception can last at most a year',
  });
export type ExceptionCreateInput = z.input<typeof exceptionCreateSchema>;

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** GET /doctors/:id/slots — `from`/`to` are clinic-local dates, inclusive. */
export const slotsQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    typeId: z.uuid({ message: 'Choose an appointment type' }),
  })
  .refine((q) => q.to >= q.from, { path: ['to'], message: '"to" must not be before "from"' })
  .refine((q) => daysBetween(q.from, q.to) < MAX_SLOT_RANGE_DAYS, {
    path: ['to'],
    message: `Ask for at most ${MAX_SLOT_RANGE_DAYS} days at a time`,
  });

/** Public doctor profile (GET /doctors). */
export interface DoctorProfile {
  id: string;
  displayName: string;
  specialty: string | null;
  bio: string | null;
  isBookable: boolean;
}

export interface AvailabilityRuleDto {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string | null;
}

export interface AvailabilityExceptionDto {
  id: string;
  type: ExceptionType;
  reason: string | null;
  /** UTC ISO instants. */
  startsAt: string;
  endsAt: string;
  /** Clinic-local "YYYY-MM-DDTHH:MM". */
  startsAtLocal: string;
  endsAtLocal: string;
}

export interface AvailabilityResponse {
  doctorId: string;
  timezone: string;
  rules: AvailabilityRuleDto[];
  /** Exceptions that haven't ended yet, soonest first. */
  exceptions: AvailabilityExceptionDto[];
}

export interface Slot {
  /** UTC ISO instants. */
  startsAt: string;
  endsAt: string;
  /** Clinic-local date (YYYY-MM-DD) and start time (HH:MM). */
  date: string;
  time: string;
}

export interface SlotsResponse {
  doctorId: string;
  appointmentTypeId: string;
  timezone: string;
  slots: Slot[];
}
