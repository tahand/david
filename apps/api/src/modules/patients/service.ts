import { randomUUID } from 'node:crypto';
import { Prisma, type Patient, type PrismaClient, type User } from '@prisma/client';
import {
  PATIENT_SEARCH_PAGE_SIZE,
  emergencyContactSchema,
  gpDetailsSchema,
  medicalSummarySchema,
  type EmergencyContact,
  type GpDetails,
  type MedicalSummary,
  type PatientExport,
  type PatientRecord,
  type PatientSearchResponse,
} from '@clinic/shared';
import { aad } from '../../lib/aad.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { getClinicSettings } from '../../lib/settings.js';
import type { RequestAudit } from '../../middleware/audit.js';
import type {
  MedicalSummaryUpdate,
  PatientCreate,
  PatientSearchQuery,
  PatientStaffUpdate,
} from './schemas.js';

type Actor = Pick<User, 'id' | 'role'>;
type PatientWithUser = Patient & { user: Pick<User, 'email'> | null };
/** Plain column values, usable in both create and update. */
type PatientColumns = Partial<Omit<Prisma.PatientUncheckedCreateInput, 'id'>>;

const withUser = { user: { select: { email: true } } } as const;
const EMPTY_SUMMARY: MedicalSummary = { allergies: [], medications: [], conditions: [] };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * Parses a date of birth typed into the search box: ISO (1990-01-31) or
 * day-first (31/01/1990, 31-01-1990, 31.01.1990). Returns null otherwise.
 */
export function parseSearchDate(text: string): Date | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dayFirst) [d, m, y] = [Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? date : null;
}

/** "sw1a1aa" → ["SW1A1AA", "SW1A 1AA"], so postcodes match with or without the space. */
export function postcodeVariants(text: string): string[] {
  if (!/^[A-Za-z0-9 ]{2,10}$/.test(text) || !/\d/.test(text)) return [];
  const upper = text.toUpperCase().trim();
  const compact = upper.replace(/\s+/g, '');
  const variants = new Set([upper]);
  if (compact.length >= 5) variants.add(`${compact.slice(0, -3)} ${compact.slice(-3)}`);
  return [...variants];
}

export interface PatientServiceDeps {
  prisma: PrismaClient;
  cipher: FieldCipher;
}

/**
 * Patient records (SPEC §6). Sensitive columns are encrypted here, and every
 * read and write is audited before the caller sees the result.
 *
 * Access: patients reach only their own record (via /me); receptionists and
 * admins reach every record; doctors reach only patients with at least one
 * appointment with them. Records outside the caller's scope are 404, never 403.
 */
export class PatientService {
  constructor(private readonly deps: PatientServiceDeps) {}

  private get prisma() {
    return this.deps.prisma;
  }

  // ---------------------------------------------------------------- self

  async getSelf(actor: Actor, audit: RequestAudit): Promise<PatientRecord> {
    const patient = await this.findSelf(actor);
    await audit({
      action: 'patient.view',
      entityType: 'patient',
      entityId: patient.id,
      metadata: { self: true },
    });
    return this.toRecord(patient);
  }

  async updateSelf(
    actor: Actor,
    input: PatientStaffUpdate,
    audit: RequestAudit,
  ): Promise<PatientRecord> {
    const patient = await this.findSelf(actor);
    return this.applyUpdate(patient.id, input, audit, { self: true });
  }

  async exportSelf(actor: Actor, audit: RequestAudit, format: 'json' | 'pdf') {
    const patient = await this.findSelf(actor);
    const [user, appointments, settings] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
      this.prisma.appointment.findMany({
        where: { patientId: patient.id },
        orderBy: { startsAt: 'desc' },
        include: {
          doctor: { select: { displayName: true } },
          appointmentType: { select: { name: true } },
        },
      }),
      getClinicSettings(this.prisma),
    ]);
    const data: PatientExport = {
      generatedAt: new Date().toISOString(),
      clinic: settings.clinicName,
      healthIdLabel: settings.healthIdLabel,
      account: {
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        mfaEnabled: user.mfaEnabled,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      },
      profile: this.toRecord(patient),
      appointments: appointments.map((a) => ({
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        status: a.status,
        doctor: a.doctor.displayName,
        appointmentType: a.appointmentType.name,
        reasonForVisit: a.reasonForVisitEnc
          ? this.deps.cipher.decrypt(a.reasonForVisitEnc, aad.appointmentReason(a.id))
          : null,
        cancelledReason: a.cancelledReason,
        bookedAt: a.createdAt.toISOString(),
      })),
    };
    await audit({
      action: 'patient.export',
      entityType: 'patient',
      entityId: patient.id,
      metadata: { format },
    });
    return data;
  }

  // --------------------------------------------------------------- staff

  async search(
    actor: Actor,
    query: PatientSearchQuery,
    audit: RequestAudit,
  ): Promise<PatientSearchResponse> {
    const pageSize = PATIENT_SEARCH_PAGE_SIZE;
    const rows = await this.prisma.patient.findMany({
      where: {
        AND: [
          { deletedAt: null },
          await this.staffScope(actor),
          await this.searchFilter(query.search ?? ''),
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * pageSize,
      take: pageSize + 1,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        postcode: true,
        phoneMobile: true,
        userId: true,
      },
    });
    const patients = rows.slice(0, pageSize);
    // The search text itself is not logged; it can contain personal details.
    await audit({
      action: 'patient.search',
      entityType: 'patient',
      metadata: {
        page: query.page,
        resultCount: patients.length,
        patientIds: patients.map((p) => p.id),
      },
    });
    return {
      patients: patients.map(({ userId, dateOfBirth, ...p }) => ({
        ...p,
        dateOfBirth: isoDate(dateOfBirth),
        hasLogin: userId !== null,
      })),
      page: query.page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }

  async create(input: PatientCreate, audit: RequestAudit): Promise<PatientRecord> {
    // The ID is generated here because the encryption AAD includes it.
    const id = randomUUID();
    const { firstName, lastName, dateOfBirth, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patient.create({
        data: {
          ...this.toWriteData(id, rest),
          id,
          firstName,
          lastName,
          dateOfBirth: toDbDate(dateOfBirth),
        },
        include: withUser,
      });
      await audit({ action: 'patient.create', entityType: 'patient', entityId: id }, tx);
      return row;
    });
    return this.toRecord(created);
  }

  async getById(actor: Actor, id: string, audit: RequestAudit): Promise<PatientRecord> {
    const patient = await this.findForStaff(actor, id, audit);
    await audit({ action: 'patient.view', entityType: 'patient', entityId: patient.id });
    return this.toRecord(patient);
  }

  async update(
    actor: Actor,
    id: string,
    input: PatientStaffUpdate,
    audit: RequestAudit,
  ): Promise<PatientRecord> {
    const patient = await this.findForStaff(actor, id, audit);
    return this.applyUpdate(patient.id, input, audit);
  }

  async replaceMedicalSummary(
    actor: Actor,
    id: string,
    input: MedicalSummaryUpdate,
    audit: RequestAudit,
  ): Promise<PatientRecord> {
    const patient = await this.findForStaff(actor, id, audit);
    const summary: MedicalSummary = {
      allergies: input.allergies,
      medications: input.medications,
      conditions: input.conditions,
    };
    const gp = input.gpDetails;
    const hasGp = !!gp && Object.values(gp).some((v) => v != null);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patient.update({
        where: { id: patient.id },
        data: {
          medicalSummaryEnc: this.deps.cipher.encrypt(
            JSON.stringify(summary),
            aad.patientMedicalSummary(patient.id),
          ),
          gpDetails: hasGp ? (gp as Prisma.InputJsonObject) : Prisma.DbNull,
          accessibilityNeeds: input.accessibilityNeeds ?? null,
        },
        include: withUser,
      });
      await audit(
        { action: 'patient.medical_summary.update', entityType: 'patient', entityId: patient.id },
        tx,
      );
      return row;
    });
    return this.toRecord(updated);
  }

  // ------------------------------------------------------------- helpers

  private async findSelf(actor: Actor): Promise<PatientWithUser> {
    const patient = await this.prisma.patient.findFirst({
      where: { userId: actor.id, deletedAt: null },
      include: withUser,
    });
    if (!patient) throw AppError.notFound('Patient record not found');
    return patient;
  }

  /** Which patients a staff member may see (SPEC §3). */
  private async staffScope(actor: Actor): Promise<Prisma.PatientWhereInput> {
    if (actor.role === 'receptionist' || actor.role === 'admin') return {};
    if (actor.role === 'doctor') {
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (doctor) return { appointments: { some: { doctorId: doctor.id } } };
    }
    return { id: { in: [] } };
  }

  private async findForStaff(
    actor: Actor,
    id: string,
    audit: RequestAudit,
  ): Promise<PatientWithUser> {
    const patient = await this.prisma.patient.findFirst({
      where: { AND: [{ id, deletedAt: null }, await this.staffScope(actor)] },
      include: withUser,
    });
    if (patient) return patient;
    // Record probes for records outside the caller's scope; the response is
    // the same 404 either way.
    const exists = await this.prisma.patient.count({ where: { id, deletedAt: null } });
    if (exists) {
      await audit({ action: 'patient.access_denied', entityType: 'patient', entityId: id });
    }
    throw AppError.notFound('Patient not found');
  }

  private async searchFilter(text: string): Promise<Prisma.PatientWhereInput> {
    if (!text) return {};
    const dob = parseSearchDate(text);
    if (dob) return { dateOfBirth: dob };

    const digits = text.replace(/[\s()+.-]/g, '');
    if (/^\d{4,}$/.test(digits)) {
      // Stored numbers keep their formatting, so compare digits only.
      const pattern = `%${digits}%`;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM patients
        WHERE deleted_at IS NULL
          AND (regexp_replace(coalesce(phone_mobile, ''), '[^0-9]', '', 'g') LIKE ${pattern}
            OR regexp_replace(coalesce(phone_alt, ''), '[^0-9]', '', 'g') LIKE ${pattern})
        LIMIT 500`;
      return { id: { in: rows.map((r) => r.id) } };
    }

    const tokens = text.split(/\s+/).filter(Boolean).slice(0, 5);
    const byName: Prisma.PatientWhereInput = {
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { startsWith: t, mode: 'insensitive' } },
          { lastName: { startsWith: t, mode: 'insensitive' } },
          { preferredName: { startsWith: t, mode: 'insensitive' } },
        ],
      })),
    };
    const byPostcode = postcodeVariants(text).map((p): Prisma.PatientWhereInput => ({
      postcode: { startsWith: p, mode: 'insensitive' },
    }));
    return { OR: [byName, ...byPostcode] };
  }

  private async applyUpdate(
    id: string,
    input: PatientStaffUpdate,
    audit: RequestAudit,
    metadata: Prisma.InputJsonObject = {},
  ): Promise<PatientRecord> {
    const data = this.toWriteData(id, input);
    const fields = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patient.update({ where: { id }, data, include: withUser });
      // Field names only; values may be sensitive.
      await audit(
        {
          action: 'patient.update',
          entityType: 'patient',
          entityId: id,
          metadata: { ...metadata, fields },
        },
        tx,
      );
      return row;
    });
    return this.toRecord(updated);
  }

  /** Maps validated input to columns, encrypting sensitive fields. */
  private toWriteData(id: string, input: PatientStaffUpdate): PatientColumns {
    const { healthId, emergencyContact, dateOfBirth, ...plain } = input;
    const data: PatientColumns = {};
    for (const [key, value] of Object.entries(plain)) {
      // The remaining keys map 1:1 onto Patient columns.
      if (value !== undefined) (data as Record<string, unknown>)[key] = value;
    }
    if (dateOfBirth !== undefined) data.dateOfBirth = toDbDate(dateOfBirth);
    if (healthId !== undefined) {
      data.healthIdEnc = healthId && this.deps.cipher.encrypt(healthId, aad.patientHealthId(id));
    }
    if (emergencyContact !== undefined) {
      data.emergencyContactEnc =
        emergencyContact &&
        this.deps.cipher.encrypt(JSON.stringify(emergencyContact), aad.patientEmergencyContact(id));
    }
    return data;
  }

  private toRecord(p: PatientWithUser): PatientRecord {
    const { cipher } = this.deps;
    const emergencyContact: EmergencyContact | null = p.emergencyContactEnc
      ? emergencyContactSchema.parse(
          JSON.parse(cipher.decrypt(p.emergencyContactEnc, aad.patientEmergencyContact(p.id))),
        )
      : null;
    const medicalSummary: MedicalSummary = p.medicalSummaryEnc
      ? medicalSummarySchema.parse(
          JSON.parse(cipher.decrypt(p.medicalSummaryEnc, aad.patientMedicalSummary(p.id))),
        )
      : EMPTY_SUMMARY;
    const gp = gpDetailsSchema.safeParse(p.gpDetails);
    const gpDetails: GpDetails | null = p.gpDetails !== null && gp.success ? gp.data : null;

    return {
      id: p.id,
      hasLogin: p.userId !== null,
      email: p.user?.email ?? p.contactEmail,
      title: p.title,
      firstName: p.firstName,
      middleNames: p.middleNames,
      lastName: p.lastName,
      preferredName: p.preferredName,
      dateOfBirth: isoDate(p.dateOfBirth),
      sexAtBirth: p.sexAtBirth,
      genderIdentity: p.genderIdentity,
      pronouns: p.pronouns,
      healthId: p.healthIdEnc ? cipher.decrypt(p.healthIdEnc, aad.patientHealthId(p.id)) : null,
      preferredLanguage: p.preferredLanguage,
      interpreterRequired: p.interpreterRequired,
      phoneMobile: p.phoneMobile,
      phoneAlt: p.phoneAlt,
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      city: p.city,
      region: p.region,
      postcode: p.postcode,
      country: p.country,
      preferredContact: p.preferredContact,
      reminderConsent: p.reminderConsent,
      emergencyContact,
      medicalSummary,
      gpDetails,
      accessibilityNeeds: p.accessibilityNeeds,
      consentVersion: p.consentVersion,
      consentAt: p.consentAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
