import { z } from 'zod';
import { calendarDateSchema } from './availability.js';
import type { Role } from './roles.js';

/**
 * Appointments (SPEC §7). Instants travel as UTC ISO strings; clinic-local
 * copies ("YYYY-MM-DDTHH:MM") are included for display.
 */

export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled_by_patient',
  'cancelled_by_clinic',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that hold the doctor's time (matches the `no_overlap` constraint). */
export const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'confirmed', 'checked_in'] as const;
/** Statuses an appointment can still be rescheduled or cancelled from. */
export const CHANGEABLE_APPOINTMENT_STATUSES = ['booked', 'confirmed'] as const;

export const isActiveStatus = (s: AppointmentStatus) =>
  (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(s);
export const isChangeableStatus = (s: AppointmentStatus) =>
  (CHANGEABLE_APPOINTMENT_STATUSES as readonly string[]).includes(s);

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled_by_patient: 'Cancelled by patient',
  cancelled_by_clinic: 'Cancelled by clinic',
  no_show: 'Did not attend',
};

/** Statuses set through PATCH /appointments/:id/status (cancellation has its own endpoint). */
export const STATUS_UPDATES = ['confirmed', 'checked_in', 'completed', 'no_show'] as const;
export type StatusUpdate = (typeof STATUS_UPDATES)[number];

/**
 * Which statuses each update may move from, who may make it, and whether the
 * appointment must already have started (SPEC §3, §7.3). Check-in is allowed
 * from the appointment's clinic-local day onwards.
 */
export const STATUS_RULES: Record<
  StatusUpdate,
  { from: readonly AppointmentStatus[]; roles: readonly Role[]; when: 'any' | 'day_of' | 'started' }
> = {
  confirmed: { from: ['booked'], roles: ['receptionist', 'admin'], when: 'any' },
  checked_in: {
    from: ['booked', 'confirmed'],
    roles: ['receptionist', 'admin', 'doctor'],
    when: 'day_of',
  },
  completed: { from: ['checked_in'], roles: ['doctor'], when: 'started' },
  no_show: {
    from: ['booked', 'confirmed'],
    roles: ['doctor', 'receptionist', 'admin'],
    when: 'started',
  },
};

export const canUpdateStatus = (role: Role, from: AppointmentStatus, to: StatusUpdate) =>
  STATUS_RULES[to].roles.includes(role) && STATUS_RULES[to].from.includes(from);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const instantSchema = z.iso.datetime({ message: 'Choose a time', offset: true });

/** POST /appointments. Staff must name the patient; patients always book for themselves. */
export const bookingCreateSchema = z.object({
  patientId: z.uuid().optional(),
  doctorId: z.uuid({ message: 'Choose a doctor' }),
  appointmentTypeId: z.uuid({ message: 'Choose an appointment type' }),
  startsAt: instantSchema,
  reasonForVisit: optionalText(500),
});
export type BookingCreateInput = z.input<typeof bookingCreateSchema>;

/** PATCH /appointments/:id/reschedule. The doctor may change; the type may not. */
export const rescheduleSchema = z.object({
  doctorId: z.uuid().optional(),
  startsAt: instantSchema,
});
export type RescheduleInput = z.input<typeof rescheduleSchema>;

/** PATCH /appointments/:id/cancel. The reason is stored in plain text, so no medical details. */
export const cancelSchema = z.object({ reason: optionalText(200) });
export type CancelInput = z.input<typeof cancelSchema>;

export const statusUpdateSchema = z.object({
  status: z.enum(STATUS_UPDATES),
  note: optionalText(200),
});
export type StatusUpdateInput = z.input<typeof statusUpdateSchema>;

/** Longest date range GET /appointments accepts. */
export const MAX_APPOINTMENT_RANGE_DAYS = 62;

/** GET /appointments — `from`/`to` are inclusive clinic-local dates. */
export const appointmentListQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    doctorId: z.uuid().optional(),
    patientId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    path: ['to'],
    message: '"to" must not be before "from"',
  })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 <
        MAX_APPOINTMENT_RANGE_DAYS,
    { path: ['to'], message: `Ask for at most ${MAX_APPOINTMENT_RANGE_DAYS} days at a time` },
  );
export type AppointmentListQuery = z.input<typeof appointmentListQuerySchema>;

export const clinicalNoteCreateSchema = z.object({
  body: z.string().trim().min(1, 'Write the note').max(10_000),
  amendsNoteId: z.uuid().optional(),
});
export type ClinicalNoteCreateInput = z.input<typeof clinicalNoteCreateSchema>;

export interface AppointmentTypeDto {
  id: string;
  name: string;
  durationMinutes: number;
  colour: string;
  patientBookable: boolean;
}

export interface AppointmentDto {
  id: string;
  status: AppointmentStatus;
  /** UTC ISO instants. */
  startsAt: string;
  endsAt: string;
  /** Clinic-local "YYYY-MM-DDTHH:MM". */
  startsAtLocal: string;
  endsAtLocal: string;
  doctor: { id: string; displayName: string };
  appointmentType: { id: string; name: string; durationMinutes: number; colour: string };
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    dateOfBirth: string;
  };
  cancelledReason: string | null;
  /** Whether the caller may reschedule or cancel it now (patients: before the cutoff). */
  canChange: boolean;
  createdAt: string;
}

/** GET /appointments/:id adds the (decrypted) reason for visit and the status history. */
export interface AppointmentDetail extends AppointmentDto {
  reasonForVisit: string | null;
  events: {
    fromStatus: AppointmentStatus | null;
    toStatus: AppointmentStatus;
    note: string | null;
    at: string;
  }[];
}

export interface AppointmentListResponse {
  appointments: AppointmentDto[];
  timezone: string;
  /** Patients: hours before the start after which changes need a phone call. */
  changeCutoffHours: number;
}

export interface ClinicalNoteDto {
  id: string;
  appointmentId: string;
  body: string;
  authorName: string;
  amendsNoteId: string | null;
  createdAt: string;
}
