import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  STATUS_LABELS,
  STATUS_RULES,
  isChangeableStatus,
  type AppointmentDetail,
  type AppointmentDto,
  type AppointmentListResponse,
  type AppointmentStatus,
  type AppointmentTypeDto,
  type ClinicSettings,
  type ClinicalNoteDto,
} from '@clinic/shared';
import { aad } from '../../lib/aad.js';
import { addCalendarDays, utcToZoned, zonedToUtc, zonedToday } from '../../lib/clinicTime.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { getClinicSettings } from '../../lib/settings.js';
import type { RequestAudit } from '../../middleware/audit.js';
import { activeDoctor, type DoctorService } from '../doctors/service.js';
import type { AppointmentNotice } from './notifications.js';
import type {
  AppointmentListFilter,
  BookingCreate,
  Cancel,
  ClinicalNoteCreate,
  Reschedule,
  StatusChange,
} from './schemas.js';

type Actor = Pick<User, 'id' | 'role' | 'emailVerifiedAt'>;
type Tx = Prisma.TransactionClient;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Upper bound on one list response; the UI asks for a day, a week or one patient. */
const LIST_LIMIT = 500;

const include = {
  doctor: { select: { id: true, displayName: true, isBookable: true } },
  appointmentType: {
    select: { id: true, name: true, durationMinutes: true, colour: true, patientBookable: true },
  },
  patient: {
    select: { id: true, firstName: true, lastName: true, preferredName: true, dateOfBirth: true },
  },
} satisfies Prisma.AppointmentInclude;
type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof include }>;

const validationError = (path: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);

const slotUnavailable = () =>
  new AppError(
    409,
    'SLOT_UNAVAILABLE',
    'That time is no longer available. Please choose another time.',
  );

const changedElsewhere = () =>
  AppError.conflict('This appointment was just changed by someone else. Refresh and try again.');

/**
 * The `no_overlap` exclusion constraint (SQLSTATE 23P01) is what actually
 * prevents double booking; Prisma surfaces it as an unmapped request error.
 */
export function isOverlapViolation(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) &&
    !(err instanceof Prisma.PrismaClientUnknownRequestError)
  ) {
    return false;
  }
  return err.message.includes('23P01') || err.message.includes('no_overlap');
}

export interface AppointmentServiceDeps {
  prisma: PrismaClient;
  cipher: FieldCipher;
  doctors: DoctorService;
  timezone: string;
  /** Emails the patient after booking, rescheduling and cancelling (SPEC §7.4). */
  notifier?: { notifyInBackground(kind: AppointmentNotice, appointmentId: string): void };
  now?: () => Date;
}

/**
 * Booking, rescheduling, cancellation, status changes and clinical notes
 * (SPEC §7). Access: patients reach their own appointments, doctors their own
 * schedule, reception and admins everything. Anything outside the caller's
 * scope is a 404. Every read and write is audited.
 */
export class AppointmentService {
  private readonly now: () => Date;

  constructor(private readonly deps: AppointmentServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get prisma() {
    return this.deps.prisma;
  }

  // -------------------------------------------------------------- types

  async listTypes(actor: Actor): Promise<AppointmentTypeDto[]> {
    const types = await this.prisma.appointmentType.findMany({
      where: { isActive: true, ...(actor.role === 'patient' ? { patientBookable: true } : {}) },
      orderBy: [{ durationMinutes: 'asc' }, { name: 'asc' }],
    });
    return types.map((t) => ({
      id: t.id,
      name: t.name,
      durationMinutes: t.durationMinutes,
      colour: t.colour,
      patientBookable: t.patientBookable,
    }));
  }

  // --------------------------------------------------------------- read

  async list(
    actor: Actor,
    query: AppointmentListFilter,
    audit: RequestAudit,
  ): Promise<AppointmentListResponse> {
    const tz = this.deps.timezone;
    // Staff schedules are always asked for by date; a patient's history isn't.
    if (actor.role !== 'patient' && !query.patientId && (!query.from || !query.to)) {
      throw validationError('from', 'Choose a date range');
    }
    const startsAt: Prisma.DateTimeFilter = {};
    if (query.from) startsAt.gte = zonedToUtc(`${query.from}T00:00`, tz);
    if (query.to) startsAt.lt = zonedToUtc(`${addCalendarDays(query.to, 1)}T00:00`, tz);

    const [rows, settings] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          AND: [
            await this.scope(actor),
            query.doctorId ? { doctorId: query.doctorId } : {},
            query.patientId ? { patientId: query.patientId } : {},
            query.from || query.to ? { startsAt } : {},
          ],
        },
        include,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      }),
      getClinicSettings(this.prisma),
    ]);
    await audit({
      action: 'appointment.list',
      entityType: 'appointment',
      metadata: {
        resultCount: rows.length,
        patientIds: [...new Set(rows.map((r) => r.patientId))],
      },
    });
    return {
      appointments: rows.map((r) => this.toDto(actor, r, settings)),
      timezone: tz,
      changeCutoffHours: settings.patientChangeCutoffHours,
    };
  }

  async get(actor: Actor, id: string, audit: RequestAudit): Promise<AppointmentDetail> {
    const row = await this.findScoped(actor, id, audit);
    const [events, settings] = await Promise.all([
      this.prisma.appointmentEvent.findMany({
        where: { appointmentId: row.id },
        orderBy: { createdAt: 'asc' },
      }),
      getClinicSettings(this.prisma),
    ]);
    await audit({
      action: 'appointment.view',
      entityType: 'appointment',
      entityId: row.id,
      metadata: { patientId: row.patientId },
    });
    return {
      ...this.toDto(actor, row, settings),
      reasonForVisit: row.reasonForVisitEnc
        ? this.deps.cipher.decrypt(row.reasonForVisitEnc, aad.appointmentReason(row.id))
        : null,
      events: events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------- write

  async book(actor: Actor, input: BookingCreate, audit: RequestAudit): Promise<AppointmentDto> {
    const forPatient = actor.role === 'patient';
    const patientId = await this.bookingPatient(actor, input.patientId);
    const { doctor, type } = await this.resolveBookable(
      forPatient,
      input.doctorId,
      input.appointmentTypeId,
    );
    const settings = await getClinicSettings(this.prisma);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE);
    await this.assertSlotOffered({
      doctorId: doctor.id,
      durationMinutes: type.durationMinutes,
      startsAt,
      forPatient,
      settings,
    });

    // The ID is generated here because the encryption AAD includes it.
    const id = randomUUID();
    await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockPatient(tx, patientId);
        await this.assertPatientFree(tx, patientId, startsAt, endsAt);
        if (forPatient) {
          const upcoming = await tx.appointment.count({
            where: {
              patientId,
              status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
              startsAt: { gt: this.now() },
            },
          });
          if (upcoming >= settings.maxFutureAppointmentsPerPatient) {
            throw AppError.conflict(
              `You can have up to ${settings.maxFutureAppointmentsPerPatient} upcoming appointments. ` +
                'Cancel one, or call the clinic, to book another.',
            );
          }
        }
        await tx.appointment.create({
          data: {
            id,
            patientId,
            doctorId: doctor.id,
            appointmentTypeId: type.id,
            startsAt,
            endsAt,
            status: 'booked',
            bookedByUserId: actor.id,
            reasonForVisitEnc: input.reasonForVisit
              ? this.deps.cipher.encrypt(input.reasonForVisit, aad.appointmentReason(id))
              : null,
          },
        });
        await tx.appointmentEvent.create({
          data: { appointmentId: id, fromStatus: null, toStatus: 'booked', actorUserId: actor.id },
        });
        await audit(
          {
            action: 'appointment.create',
            entityType: 'appointment',
            entityId: id,
            metadata: {
              patientId,
              doctorId: doctor.id,
              appointmentTypeId: type.id,
              onBehalf: !forPatient,
            },
          },
          tx,
        );
      }),
    );
    this.deps.notifier?.notifyInBackground('booked', id);
    return this.dtoById(actor, id, settings);
  }

  async reschedule(
    actor: Actor,
    id: string,
    input: Reschedule,
    audit: RequestAudit,
  ): Promise<AppointmentDto> {
    const forPatient = actor.role === 'patient';
    const row = await this.findScoped(actor, id, audit);
    const settings = await getClinicSettings(this.prisma);
    this.assertChangeable(actor, row, settings);
    const { doctor, type } = await this.resolveBookable(
      forPatient,
      input.doctorId ?? row.doctorId,
      row.appointmentTypeId,
    );
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE);
    await this.assertSlotOffered({
      doctorId: doctor.id,
      durationMinutes: type.durationMinutes,
      startsAt,
      forPatient,
      settings,
      excludeAppointmentId: row.id,
    });

    await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockPatient(tx, row.patientId);
        await this.assertPatientFree(tx, row.patientId, startsAt, endsAt, row.id);
        const { count } = await tx.appointment.updateMany({
          where: { id: row.id, status: row.status, startsAt: row.startsAt },
          // A moved appointment needs confirming again and a fresh reminder.
          data: { doctorId: doctor.id, startsAt, endsAt, status: 'booked', reminderSentAt: null },
        });
        if (count === 0) throw changedElsewhere();
        await tx.appointmentEvent.create({
          data: {
            appointmentId: row.id,
            fromStatus: row.status,
            toStatus: 'booked',
            actorUserId: actor.id,
            note: 'Rescheduled',
          },
        });
        await audit(
          {
            action: 'appointment.reschedule',
            entityType: 'appointment',
            entityId: row.id,
            metadata: {
              patientId: row.patientId,
              fromDoctorId: row.doctorId,
              toDoctorId: doctor.id,
            },
          },
          tx,
        );
      }),
    );
    this.deps.notifier?.notifyInBackground('rescheduled', row.id);
    return this.dtoById(actor, row.id, settings);
  }

  async cancel(
    actor: Actor,
    id: string,
    input: Cancel,
    audit: RequestAudit,
  ): Promise<AppointmentDto> {
    const row = await this.findScoped(actor, id, audit);
    const settings = await getClinicSettings(this.prisma);
    this.assertChangeable(actor, row, settings);
    const toStatus: AppointmentStatus =
      actor.role === 'patient' ? 'cancelled_by_patient' : 'cancelled_by_clinic';
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, row, toStatus, actor, null, { cancelledReason: input.reason });
      await audit(
        {
          action: 'appointment.cancel',
          entityType: 'appointment',
          entityId: row.id,
          metadata: { patientId: row.patientId, status: toStatus },
        },
        tx,
      );
    });
    this.deps.notifier?.notifyInBackground('cancelled', row.id);
    return this.dtoById(actor, row.id, settings);
  }

  async updateStatus(
    actor: Actor,
    id: string,
    input: StatusChange,
    audit: RequestAudit,
  ): Promise<AppointmentDto> {
    const row = await this.findScoped(actor, id, audit);
    const rule = STATUS_RULES[input.status];
    if (!rule.roles.includes(actor.role)) throw AppError.forbidden();
    if (!rule.from.includes(row.status)) {
      throw AppError.conflict(
        `A ${STATUS_LABELS[row.status].toLowerCase()} appointment can't be marked as ` +
          `${STATUS_LABELS[input.status].toLowerCase()}.`,
      );
    }
    const now = this.now();
    if (
      rule.when === 'day_of' &&
      utcToZoned(row.startsAt, this.deps.timezone).date > zonedToday(this.deps.timezone, now)
    ) {
      throw AppError.conflict('Patients can be checked in on the day of their appointment.');
    }
    if (rule.when === 'started' && row.startsAt > now) {
      throw AppError.conflict("This appointment hasn't started yet.");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, row, input.status, actor, input.note);
      await audit(
        {
          action: 'appointment.status',
          entityType: 'appointment',
          entityId: row.id,
          metadata: { patientId: row.patientId, from: row.status, to: input.status },
        },
        tx,
      );
    });
    return this.dtoById(actor, row.id, await getClinicSettings(this.prisma));
  }

  // ------------------------------------------------------ clinical notes

  /** Notes on one of the doctor's own appointments, oldest first (amendments are new rows). */
  async listNotes(actor: Actor, id: string, audit: RequestAudit): Promise<ClinicalNoteDto[]> {
    const row = await this.findScoped(actor, id, audit);
    const notes = await this.prisma.clinicalNote.findMany({
      where: { appointmentId: row.id },
      include: { authorDoctor: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    await audit({
      action: 'clinical_note.view',
      entityType: 'appointment',
      entityId: row.id,
      metadata: { patientId: row.patientId, noteCount: notes.length },
    });
    return notes.map((n) => ({
      id: n.id,
      appointmentId: n.appointmentId,
      body: this.deps.cipher.decrypt(n.bodyEnc, aad.clinicalNoteBody(n.id)),
      authorName: n.authorDoctor.displayName,
      amendsNoteId: n.amendsNoteId,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async addNote(
    actor: Actor,
    id: string,
    input: ClinicalNoteCreate,
    audit: RequestAudit,
  ): Promise<ClinicalNoteDto> {
    const row = await this.findScoped(actor, id, audit);
    if (row.status === 'cancelled_by_patient' || row.status === 'cancelled_by_clinic') {
      throw AppError.conflict("Notes can't be added to a cancelled appointment.");
    }
    if (input.amendsNoteId) {
      const original = await this.prisma.clinicalNote.count({
        where: { id: input.amendsNoteId, appointmentId: row.id },
      });
      if (!original) throw validationError('amendsNoteId', 'That note is not on this appointment');
    }
    // Scoped to the actor's own appointments, so the author is the appointment's doctor.
    const noteId = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      const note = await tx.clinicalNote.create({
        data: {
          id: noteId,
          appointmentId: row.id,
          patientId: row.patientId,
          authorDoctorId: row.doctorId,
          bodyEnc: this.deps.cipher.encrypt(input.body, aad.clinicalNoteBody(noteId)),
          amendsNoteId: input.amendsNoteId ?? null,
        },
      });
      await audit(
        {
          action: 'clinical_note.create',
          entityType: 'clinical_note',
          entityId: noteId,
          metadata: {
            appointmentId: row.id,
            patientId: row.patientId,
            amendsNoteId: input.amendsNoteId ?? null,
          },
        },
        tx,
      );
      return note;
    });
    return {
      id: created.id,
      appointmentId: row.id,
      body: input.body,
      authorName: row.doctor.displayName,
      amendsNoteId: created.amendsNoteId,
      createdAt: created.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------------- helpers

  /** Which appointments the caller may see (SPEC §3). */
  private async scope(actor: Actor): Promise<Prisma.AppointmentWhereInput> {
    if (actor.role === 'receptionist' || actor.role === 'admin') {
      return { patient: { deletedAt: null } };
    }
    if (actor.role === 'patient') return { patient: { userId: actor.id, deletedAt: null } };
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    return doctor ? { doctorId: doctor.id, patient: { deletedAt: null } } : { id: { in: [] } };
  }

  private async findScoped(actor: Actor, id: string, audit: RequestAudit): Promise<AppointmentRow> {
    const row = await this.prisma.appointment.findFirst({
      where: { AND: [{ id }, await this.scope(actor)] },
      include,
    });
    if (row) return row;
    // Record probes for appointments outside the caller's scope; the response is the same.
    if (await this.prisma.appointment.count({ where: { id } })) {
      await audit({ action: 'appointment.access_denied', entityType: 'appointment', entityId: id });
    }
    throw AppError.notFound('Appointment not found');
  }

  private async dtoById(
    actor: Actor,
    id: string,
    settings: ClinicSettings,
  ): Promise<AppointmentDto> {
    const row = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include });
    return this.toDto(actor, row, settings);
  }

  private async bookingPatient(actor: Actor, patientId: string | undefined): Promise<string> {
    if (actor.role === 'patient') {
      if (!actor.emailVerifiedAt) {
        throw new AppError(
          403,
          'EMAIL_NOT_VERIFIED',
          'Confirm your email address before booking an appointment.',
        );
      }
      const own = await this.prisma.patient.findFirst({
        where: { userId: actor.id, deletedAt: null },
        select: { id: true },
      });
      if (!own) throw AppError.notFound('Patient record not found');
      return own.id;
    }
    if (!patientId) throw validationError('patientId', 'Choose a patient');
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw AppError.notFound('Patient not found');
    return patient.id;
  }

  /** Patients may only use bookable doctors and patient-bookable types. */
  private async resolveBookable(forPatient: boolean, doctorId: string, typeId: string) {
    const [doctor, type] = await Promise.all([
      this.prisma.doctor.findFirst({
        where: { ...activeDoctor, id: doctorId, ...(forPatient ? { isBookable: true } : {}) },
      }),
      this.prisma.appointmentType.findFirst({
        where: { id: typeId, isActive: true, ...(forPatient ? { patientBookable: true } : {}) },
      }),
    ]);
    if (!doctor) throw AppError.notFound('Doctor not found');
    if (!type) throw AppError.notFound('Appointment type not found');
    return { doctor, type };
  }

  /**
   * The start must be one of the slots offered for that day. This is a
   * friendly early check; the exclusion constraint settles races.
   */
  private async assertSlotOffered(opts: {
    doctorId: string;
    durationMinutes: number;
    startsAt: Date;
    forPatient: boolean;
    settings: ClinicSettings;
    excludeAppointmentId?: string;
  }): Promise<void> {
    const now = this.now();
    const { settings } = opts;
    if (opts.startsAt <= now) throw validationError('startsAt', 'This time has already passed');
    if (opts.forPatient) {
      if (opts.startsAt.getTime() < now.getTime() + settings.bookingMinLeadMinutes * MINUTE) {
        throw validationError(
          'startsAt',
          `Online bookings need at least ${settings.bookingMinLeadMinutes} minutes' notice`,
        );
      }
      if (opts.startsAt.getTime() > now.getTime() + settings.bookingMaxDaysAhead * 24 * HOUR) {
        throw validationError(
          'startsAt',
          `You can book up to ${settings.bookingMaxDaysAhead} days ahead`,
        );
      }
    }
    const date = utcToZoned(opts.startsAt, this.deps.timezone).date;
    const slots = await this.deps.doctors.availableSlots({
      doctorId: opts.doctorId,
      durationMinutes: opts.durationMinutes,
      from: date,
      to: date,
      forPatient: opts.forPatient,
      excludeAppointmentId: opts.excludeAppointmentId,
    });
    if (!slots.some((s) => s.start.getTime() === opts.startsAt.getTime())) {
      throw slotUnavailable();
    }
  }

  /**
   * Serialises bookings per patient so concurrent requests can't exceed the
   * upcoming-appointment limit or overlap each other.
   */
  private async lockPatient(tx: Tx, patientId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId}::uuid FOR UPDATE`;
  }

  private async assertPatientFree(
    tx: Tx,
    patientId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const clash = await tx.appointment.count({
      where: {
        patientId,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) throw AppError.conflict('The patient already has an appointment at this time.');
  }

  private async withOverlapGuard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      if (isOverlapViolation(err)) throw slotUnavailable();
      throw err;
    }
  }

  /** Reschedule/cancel: only booked or confirmed, in the future, and (patients) before the cutoff. */
  private assertChangeable(actor: Actor, row: AppointmentRow, settings: ClinicSettings): void {
    if (!isChangeableStatus(row.status) || row.startsAt <= this.now()) {
      throw AppError.conflict('This appointment can no longer be changed.');
    }
    if (actor.role === 'patient' && !this.patientMayChange(row, settings)) {
      throw new AppError(
        409,
        'CHANGE_WINDOW_CLOSED',
        `Appointments can't be changed online less than ${settings.patientChangeCutoffHours} ` +
          `hours before they start. Please call the clinic on ${settings.clinicPhone}.`,
      );
    }
  }

  private patientMayChange(row: AppointmentRow, settings: ClinicSettings): boolean {
    return (
      row.startsAt.getTime() - this.now().getTime() >= settings.patientChangeCutoffHours * HOUR &&
      row.appointmentType.patientBookable &&
      row.doctor.isBookable
    );
  }

  /** Moves the status on, guarding against a concurrent change, and records the event. */
  private async transition(
    tx: Tx,
    row: AppointmentRow,
    toStatus: AppointmentStatus,
    actor: Actor,
    note: string | null,
    extra: Prisma.AppointmentUpdateManyMutationInput = {},
  ): Promise<void> {
    const { count } = await tx.appointment.updateMany({
      where: { id: row.id, status: row.status },
      data: { ...extra, status: toStatus },
    });
    if (count === 0) throw changedElsewhere();
    await tx.appointmentEvent.create({
      data: {
        appointmentId: row.id,
        fromStatus: row.status,
        toStatus,
        actorUserId: actor.id,
        note,
      },
    });
  }

  private toDto(actor: Actor, row: AppointmentRow, settings: ClinicSettings): AppointmentDto {
    const tz = this.deps.timezone;
    const changeable = isChangeableStatus(row.status) && row.startsAt > this.now();
    const canChange =
      actor.role === 'patient'
        ? changeable && this.patientMayChange(row, settings)
        : actor.role === 'receptionist' || actor.role === 'admin'
          ? changeable
          : false;
    return {
      id: row.id,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      startsAtLocal: utcToZoned(row.startsAt, tz).dateTime,
      endsAtLocal: utcToZoned(row.endsAt, tz).dateTime,
      doctor: { id: row.doctor.id, displayName: row.doctor.displayName },
      appointmentType: {
        id: row.appointmentType.id,
        name: row.appointmentType.name,
        durationMinutes: row.appointmentType.durationMinutes,
        colour: row.appointmentType.colour,
      },
      patient: {
        id: row.patient.id,
        firstName: row.patient.firstName,
        lastName: row.patient.lastName,
        preferredName: row.patient.preferredName,
        dateOfBirth: row.patient.dateOfBirth.toISOString().slice(0, 10),
      },
      cancelledReason: row.cancelledReason,
      canChange,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
