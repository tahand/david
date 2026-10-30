import type { Doctor, Prisma, PrismaClient, User } from '@prisma/client';
import type {
  AvailabilityExceptionDto,
  AvailabilityResponse,
  DoctorProfile,
  SlotsResponse,
} from '@clinic/shared';
import {
  addCalendarDays,
  dateColumnToString,
  dateStringToColumn,
  timeColumnToString,
  timeStringToColumn,
  utcToZoned,
  zonedToUtc,
  zonedToday,
} from '../../lib/clinicTime.js';
import { AppError } from '../../lib/errors.js';
import { getClinicSettings } from '../../lib/settings.js';
import { computeSlots } from '../../lib/slots.js';
import type { RequestAudit } from '../../middleware/audit.js';
import type { AvailabilityUpdate, ExceptionCreate, SlotsQuery } from './schemas.js';

type Actor = Pick<User, 'id' | 'role'>;

/** Appointment statuses that hold a doctor's time (matches the no_overlap constraint). */
export const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'confirmed', 'checked_in'] as const;

/** Doctors whose login is active and not deleted. */
const activeDoctor: Prisma.DoctorWhereInput = { user: { isActive: true, deletedAt: null } };

const toProfile = (d: Doctor): DoctorProfile => ({
  id: d.id,
  displayName: d.displayName,
  specialty: d.specialty,
  bio: d.bio,
  isBookable: d.isBookable,
});

export interface DoctorServiceDeps {
  prisma: PrismaClient;
  timezone: string;
  now?: () => Date;
}

/**
 * Doctors, weekly availability, exceptions and slots (SPEC §7.1, §9).
 * Availability is managed by the doctor themselves or an admin.
 */
export class DoctorService {
  private readonly now: () => Date;

  constructor(private readonly deps: DoctorServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get prisma() {
    return this.deps.prisma;
  }

  /** Patients see bookable doctors only; staff also see non-bookable ones. */
  async list(actor: Actor): Promise<DoctorProfile[]> {
    const doctors = await this.prisma.doctor.findMany({
      where: { ...activeDoctor, ...(actor.role === 'patient' ? { isBookable: true } : {}) },
      orderBy: { displayName: 'asc' },
    });
    return doctors.map(toProfile);
  }

  async getSelf(actor: Actor): Promise<DoctorProfile> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { ...activeDoctor, userId: actor.id },
    });
    if (!doctor) throw AppError.notFound('No doctor profile for this account');
    return toProfile(doctor);
  }

  async getAvailability(actor: Actor, doctorId: string): Promise<AvailabilityResponse> {
    const doctor = await this.findManageable(actor, doctorId);
    return this.availabilityOf(doctor.id);
  }

  /** Replaces the weekly schedule from today (clinic time) onwards. */
  async replaceRules(
    actor: Actor,
    doctorId: string,
    input: AvailabilityUpdate,
    audit: RequestAudit,
  ): Promise<AvailabilityResponse> {
    const doctor = await this.findManageable(actor, doctorId);
    const validFrom = dateStringToColumn(zonedToday(this.deps.timezone, this.now()));
    await this.prisma.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { doctorId: doctor.id } });
      await tx.availabilityRule.createMany({
        data: input.rules.map((r) => ({
          doctorId: doctor.id,
          weekday: r.weekday,
          startTime: timeStringToColumn(r.startTime),
          endTime: timeStringToColumn(r.endTime),
          validFrom,
        })),
      });
      await audit(
        {
          action: 'availability.update',
          entityType: 'doctor',
          entityId: doctor.id,
          metadata: { blocks: input.rules.length },
        },
        tx,
      );
    });
    return this.availabilityOf(doctor.id);
  }

  async addException(
    actor: Actor,
    doctorId: string,
    input: ExceptionCreate,
    audit: RequestAudit,
  ): Promise<AvailabilityExceptionDto> {
    const doctor = await this.findManageable(actor, doctorId);
    const startsAt = zonedToUtc(input.startsAt, this.deps.timezone);
    const endsAt = zonedToUtc(input.endsAt, this.deps.timezone);
    if (endsAt <= startsAt) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'endsAt', message: 'End must be after the start' },
      ]);
    }
    if (endsAt <= this.now()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'endsAt', message: 'This time has already passed' },
      ]);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.availabilityException.create({
        data: { doctorId: doctor.id, type: input.type, startsAt, endsAt, reason: input.reason },
      });
      await audit(
        {
          action: 'availability_exception.create',
          entityType: 'availability_exception',
          entityId: row.id,
          metadata: { doctorId: doctor.id, type: input.type },
        },
        tx,
      );
      return row;
    });
    return this.toExceptionDto(created);
  }

  async deleteException(
    actor: Actor,
    doctorId: string,
    exceptionId: string,
    audit: RequestAudit,
  ): Promise<void> {
    const doctor = await this.findManageable(actor, doctorId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.availabilityException.deleteMany({
        where: { id: exceptionId, doctorId: doctor.id },
      });
      if (count === 0) throw AppError.notFound('Exception not found');
      await audit(
        {
          action: 'availability_exception.delete',
          entityType: 'availability_exception',
          entityId: exceptionId,
          metadata: { doctorId: doctor.id },
        },
        tx,
      );
    });
  }

  /**
   * Bookable slots (SPEC §7.1–7.2). Patients only see bookable doctors and
   * patient-bookable types, within the minimum lead time and booking horizon;
   * staff see any future slot.
   */
  async slots(actor: Actor, doctorId: string, query: SlotsQuery): Promise<SlotsResponse> {
    const isPatient = actor.role === 'patient';
    const tz = this.deps.timezone;
    const doctor = await this.prisma.doctor.findFirst({
      where: { ...activeDoctor, id: doctorId, ...(isPatient ? { isBookable: true } : {}) },
    });
    if (!doctor) throw AppError.notFound('Doctor not found');
    const type = await this.prisma.appointmentType.findFirst({
      where: { id: query.typeId, isActive: true, ...(isPatient ? { patientBookable: true } : {}) },
    });
    if (!type) throw AppError.notFound('Appointment type not found');

    const rangeStart = zonedToUtc(`${query.from}T00:00`, tz);
    const rangeEnd = zonedToUtc(`${addCalendarDays(query.to, 1)}T00:00`, tz);
    const overlapping = { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } };

    const [rules, exceptions, appointments, settings] = await Promise.all([
      this.prisma.availabilityRule.findMany({ where: { doctorId: doctor.id } }),
      this.prisma.availabilityException.findMany({
        where: { doctorId: doctor.id, ...overlapping },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
          ...overlapping,
        },
        select: { startsAt: true, endsAt: true },
      }),
      getClinicSettings(this.prisma),
    ]);

    const now = this.now();
    const slots = computeSlots({
      rules: rules.map((r) => ({
        weekday: r.weekday,
        startTime: timeColumnToString(r.startTime),
        endTime: timeColumnToString(r.endTime),
        validFrom: dateColumnToString(r.validFrom),
        validTo: r.validTo ? dateColumnToString(r.validTo) : null,
      })),
      exceptions: exceptions.map((e) => ({ type: e.type, start: e.startsAt, end: e.endsAt })),
      busy: appointments.map((a) => ({ start: a.startsAt, end: a.endsAt })),
      from: query.from,
      to: query.to,
      timeZone: tz,
      durationMinutes: type.durationMinutes,
      notBefore: isPatient
        ? new Date(now.getTime() + settings.bookingMinLeadMinutes * 60_000)
        : now,
      notAfter: isPatient
        ? new Date(now.getTime() + settings.bookingMaxDaysAhead * 86_400_000)
        : undefined,
    });

    return {
      doctorId: doctor.id,
      appointmentTypeId: type.id,
      timezone: tz,
      slots: slots.map((s) => {
        const local = utcToZoned(s.start, tz);
        return {
          startsAt: s.start.toISOString(),
          endsAt: s.end.toISOString(),
          date: local.date,
          time: local.time,
        };
      }),
    };
  }

  // ------------------------------------------------------------- helpers

  /**
   * The doctor must exist (404) and the caller must be that doctor or an
   * admin (403: doctor IDs are public via GET /doctors, so nothing is hidden).
   */
  private async findManageable(actor: Actor, doctorId: string): Promise<Doctor> {
    const doctor = await this.prisma.doctor.findFirst({ where: { ...activeDoctor, id: doctorId } });
    if (!doctor) throw AppError.notFound('Doctor not found');
    if (actor.role !== 'admin' && doctor.userId !== actor.id) throw AppError.forbidden();
    return doctor;
  }

  private async availabilityOf(doctorId: string): Promise<AvailabilityResponse> {
    const [rules, exceptions] = await Promise.all([
      this.prisma.availabilityRule.findMany({
        where: { doctorId },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.availabilityException.findMany({
        where: { doctorId, endsAt: { gt: this.now() } },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
    return {
      doctorId,
      timezone: this.deps.timezone,
      rules: rules.map((r) => ({
        id: r.id,
        weekday: r.weekday,
        startTime: timeColumnToString(r.startTime),
        endTime: timeColumnToString(r.endTime),
        validFrom: dateColumnToString(r.validFrom),
        validTo: r.validTo ? dateColumnToString(r.validTo) : null,
      })),
      exceptions: exceptions.map((e) => this.toExceptionDto(e)),
    };
  }

  private toExceptionDto(e: {
    id: string;
    type: 'unavailable' | 'extra';
    reason: string | null;
    startsAt: Date;
    endsAt: Date;
  }): AvailabilityExceptionDto {
    return {
      id: e.id,
      type: e.type,
      reason: e.reason,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      startsAtLocal: utcToZoned(e.startsAt, this.deps.timezone).dateTime,
      endsAtLocal: utcToZoned(e.endsAt, this.deps.timezone).dateTime,
    };
  }
}
