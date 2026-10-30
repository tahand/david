import { Prisma, type PrismaClient, type User } from '@prisma/client';
import {
  clinicSettingsSchema,
  isStaffRole,
  type AdminAppointmentTypeDto,
  type AdminUserDto,
  type AdminUserListResponse,
  type AppointmentTypeCreateInput,
  type AppointmentTypeUpdateInput,
  type AuditLogListResponse,
  type AuditLogQuery,
  type ClinicSettings,
  type SettingsUpdateInput,
  type StaffCreateInput,
  type UserListQuery,
  type UserUpdateInput,
} from '@clinic/shared';
import { addCalendarDays, zonedToUtc } from '../../lib/clinicTime.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { getClinicSettings } from '../../lib/settings.js';
import { randomToken } from '../../lib/tokens.js';
import type { RequestAudit } from '../../middleware/audit.js';
import type { AuthService } from '../auth/service.js';
import type { SessionStore } from '../auth/sessions.js';

const USER_PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses that occupy a doctor's time (same set as the no_overlap constraint). */
const UPCOMING_STATUSES = ['booked', 'confirmed', 'checked_in'] as const;

export interface AdminServiceDeps {
  prisma: PrismaClient;
  sessions: SessionStore;
  auth: Pick<AuthService, 'issuePasswordLink'>;
  timezone: string;
  now?: () => Date;
}

type Actor = Pick<User, 'id' | 'role'>;

const userInclude = {
  doctor: true,
  _count: { select: { emailTokens: { where: { type: 'invite', usedAt: null } } } },
} satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
const validation = (path: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Admin operations (SPEC §3, §9 Admin): staff accounts, appointment types,
 * clinic settings and the audit log. Routes authorize `admin:*`; this class
 * enforces the business rules and writes an audit row for every change.
 */
export class AdminService {
  constructor(private readonly deps: AdminServiceDeps) {}

  private get prisma() {
    return this.deps.prisma;
  }
  private now() {
    return this.deps.now?.() ?? new Date();
  }

  // ------------------------------------------------------------------ users

  private toUserDto(u: UserRow): AdminUserDto {
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      emailVerified: u.emailVerifiedAt !== null,
      mfaEnabled: u.mfaEnabled,
      invitePending: u.lastLoginAt === null && u._count.emailTokens > 0,
      lockedUntil: u.lockedUntil && u.lockedUntil > this.now() ? u.lockedUntil.toISOString() : null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      doctor: u.doctor
        ? {
            id: u.doctor.id,
            displayName: u.doctor.displayName,
            specialty: u.doctor.specialty,
            registrationNumber: u.doctor.registrationNumber,
            bio: u.doctor.bio,
            isBookable: u.doctor.isBookable,
          }
        : null,
    };
  }

  private async findUser(id: string): Promise<UserRow> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: userInclude,
    });
    if (!user) throw AppError.notFound('User not found');
    return user;
  }

  async listUsers(query: UserListQuery): Promise<AdminUserListResponse> {
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { doctor: { displayName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      skip: (query.page - 1) * USER_PAGE_SIZE,
      take: USER_PAGE_SIZE + 1,
    });
    return {
      users: rows.slice(0, USER_PAGE_SIZE).map((u) => this.toUserDto(u)),
      hasMore: rows.length > USER_PAGE_SIZE,
    };
  }

  async getUser(id: string): Promise<AdminUserDto> {
    return this.toUserDto(await this.findUser(id));
  }

  /**
   * Creates a staff account with an unusable password and emails a 72-hour
   * link to choose one. The new user must then enrol in MFA (SPEC §4.1).
   */
  async createStaff(input: StaffCreateInput, audit: RequestAudit): Promise<AdminUserDto> {
    // Nobody knows this password; the invitation link is the only way in.
    const passwordHash = await hashPassword(randomToken(32));
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, role: input.role, passwordHash },
        });
        if (input.role === 'doctor' && input.doctor) {
          await tx.doctor.create({
            data: {
              userId: user.id,
              displayName: input.doctor.displayName,
              specialty: input.doctor.specialty ?? null,
              registrationNumber: input.doctor.registrationNumber ?? null,
              bio: input.doctor.bio ?? null,
              isBookable: input.doctor.isBookable ?? true,
            },
          });
        }
        await audit(
          {
            action: 'admin.user.created',
            entityType: 'user',
            entityId: user.id,
            metadata: { role: input.role },
          },
          tx,
        );
        return user.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A user with this email address already exists');
      throw err;
    }
    const user = await this.findUser(userId);
    await this.deps.auth.issuePasswordLink(user, 'new_account');
    return this.toUserDto(await this.findUser(userId));
  }

  private async upcomingAppointmentsFor(doctorId: string): Promise<number> {
    return this.prisma.appointment.count({
      where: { doctorId, status: { in: [...UPCOMING_STATUSES] }, endsAt: { gt: this.now() } },
    });
  }

  private async otherActiveAdmins(userId: string): Promise<number> {
    return this.prisma.user.count({
      where: { role: 'admin', isActive: true, deletedAt: null, id: { not: userId } },
    });
  }

  /**
   * Role changes (between staff roles), activation and doctor profile edits.
   * Changing role or deactivating ends every session for that user (SPEC §4.3:
   * rotate on privilege change).
   */
  async updateUser(
    actor: Actor,
    id: string,
    input: UserUpdateInput,
    audit: RequestAudit,
  ): Promise<AdminUserDto> {
    const user = await this.findUser(id);
    const roleChanging = input.role !== undefined && input.role !== user.role;
    const deactivating = input.isActive === false && user.isActive;
    const activeChanging = input.isActive !== undefined && input.isActive !== user.isActive;

    if (user.id === actor.id && (roleChanging || deactivating)) {
      throw conflict("You can't change your own role or deactivate your own account");
    }
    if (roleChanging && !isStaffRole(user.role)) {
      throw conflict("Patient accounts can't be given a staff role");
    }
    const nextRole = input.role ?? user.role;
    if (user.role === 'admin' && (nextRole !== 'admin' || deactivating) && user.isActive) {
      if ((await this.otherActiveAdmins(user.id)) === 0) {
        throw conflict('There must always be at least one active admin');
      }
    }
    if (user.doctor && user.role === 'doctor' && (nextRole !== 'doctor' || deactivating)) {
      const upcoming = await this.upcomingAppointmentsFor(user.doctor.id);
      if (upcoming > 0) {
        throw conflict(
          `This doctor has ${upcoming} upcoming appointment${upcoming === 1 ? '' : 's'}. Move or cancel ${upcoming === 1 ? 'it' : 'them'} first.`,
        );
      }
    }
    if (input.doctor && nextRole !== 'doctor') {
      throw validation('doctor', 'Only doctors have a doctor profile');
    }
    const displayName = input.doctor?.displayName ?? user.doctor?.displayName;
    if (nextRole === 'doctor' && !displayName) {
      throw validation('doctor.displayName', 'Enter the name patients will see');
    }

    const changes = [
      ...(roleChanging ? ['role'] : []),
      ...(activeChanging ? ['isActive'] : []),
      ...Object.keys(input.doctor ?? {}).map((k) => `doctor.${k}`),
    ];

    await this.prisma.$transaction(async (tx) => {
      if (roleChanging || activeChanging) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            ...(roleChanging ? { role: nextRole } : {}),
            ...(activeChanging ? { isActive: input.isActive } : {}),
          },
        });
      }
      if (nextRole === 'doctor' && (input.doctor || !user.doctor)) {
        const profile = {
          ...(input.doctor?.specialty !== undefined ? { specialty: input.doctor.specialty } : {}),
          ...(input.doctor?.registrationNumber !== undefined
            ? { registrationNumber: input.doctor.registrationNumber }
            : {}),
          ...(input.doctor?.bio !== undefined ? { bio: input.doctor.bio } : {}),
          ...(input.doctor?.isBookable !== undefined
            ? { isBookable: input.doctor.isBookable }
            : {}),
        };
        await tx.doctor.upsert({
          where: { userId: user.id },
          create: { userId: user.id, displayName: displayName!, ...profile },
          update: { ...(input.doctor?.displayName ? { displayName } : {}), ...profile },
        });
      }
      await audit(
        {
          action: 'admin.user.updated',
          entityType: 'user',
          entityId: user.id,
          metadata: {
            changes,
            ...(roleChanging ? { fromRole: user.role, toRole: nextRole } : {}),
            ...(activeChanging ? { isActive: input.isActive! } : {}),
          },
        },
        tx,
      );
    });

    if (roleChanging || activeChanging) await this.deps.sessions.destroyAllForUser(user.id);
    return this.getUser(user.id);
  }

  /**
   * Replaces the password with an unusable one, signs the user out everywhere
   * and emails them a 72-hour link to choose a new password.
   */
  async forcePasswordReset(actor: Actor, id: string, audit: RequestAudit): Promise<AdminUserDto> {
    const user = await this.findUser(id);
    if (user.id === actor.id) {
      throw conflict('Change your own password from Account security');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(randomToken(32)),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await audit(
        { action: 'admin.user.password_reset', entityType: 'user', entityId: user.id },
        tx,
      );
    });
    await this.deps.sessions.destroyAllForUser(user.id);
    if (user.isActive) await this.deps.auth.issuePasswordLink(user, 'admin_reset');
    return this.getUser(user.id);
  }

  /**
   * Removes the user's authenticator and recovery codes (e.g. a lost phone) and
   * signs them out. Staff must enrol again at their next sign-in.
   */
  async resetMfa(actor: Actor, id: string, audit: RequestAudit): Promise<AdminUserDto> {
    const user = await this.findUser(id);
    if (user.id === actor.id) {
      throw conflict("You can't reset your own two-step verification; ask another admin");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecretEnc: null, mfaLastTimeStep: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await audit({ action: 'admin.user.mfa_reset', entityType: 'user', entityId: user.id }, tx);
    });
    await this.deps.sessions.destroyAllForUser(user.id);
    return this.getUser(user.id);
  }

  // ------------------------------------------------------- appointment types

  private toTypeDto(t: {
    id: string;
    name: string;
    durationMinutes: number;
    colour: string;
    patientBookable: boolean;
    isActive: boolean;
  }): AdminAppointmentTypeDto {
    return {
      id: t.id,
      name: t.name,
      durationMinutes: t.durationMinutes,
      colour: t.colour.toUpperCase(),
      patientBookable: t.patientBookable,
      isActive: t.isActive,
    };
  }

  async listAppointmentTypes(): Promise<AdminAppointmentTypeDto[]> {
    const rows = await this.prisma.appointmentType.findMany({
      orderBy: [{ isActive: 'desc' }, { durationMinutes: 'asc' }, { name: 'asc' }],
    });
    return rows.map((t) => this.toTypeDto(t));
  }

  async createAppointmentType(
    input: AppointmentTypeCreateInput,
    audit: RequestAudit,
  ): Promise<AdminAppointmentTypeDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.appointmentType.create({ data: input });
        await audit(
          {
            action: 'admin.appointment_type.created',
            entityType: 'appointment_type',
            entityId: row.id,
          },
          tx,
        );
        return this.toTypeDto(row);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('An appointment type with this name already exists');
      throw err;
    }
  }

  /**
   * Edits apply to new bookings only: existing appointments keep the times
   * they were booked with.
   */
  async updateAppointmentType(
    id: string,
    input: AppointmentTypeUpdateInput,
    audit: RequestAudit,
  ): Promise<AdminAppointmentTypeDto> {
    const existing = await this.prisma.appointmentType.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Appointment type not found');
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.appointmentType.update({ where: { id }, data });
        await audit(
          {
            action: 'admin.appointment_type.updated',
            entityType: 'appointment_type',
            entityId: id,
            metadata: { changes: Object.keys(data) },
          },
          tx,
        );
        return this.toTypeDto(row);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('An appointment type with this name already exists');
      throw err;
    }
  }

  // ---------------------------------------------------------------- settings

  getSettings(): Promise<ClinicSettings> {
    return getClinicSettings(this.prisma);
  }

  /** Partial update; the merged settings must still be valid as a whole. */
  async updateSettings(input: SettingsUpdateInput, audit: RequestAudit): Promise<ClinicSettings> {
    const current = await getClinicSettings(this.prisma);
    const merged = clinicSettingsSchema.parse({ ...current, ...input });
    const changed = (Object.keys(input) as (keyof ClinicSettings)[]).filter(
      (k) => JSON.stringify(current[k]) !== JSON.stringify(merged[k]),
    );
    if (changed.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const key of changed) {
          const value = merged[key] as Prisma.InputJsonValue;
          await tx.clinicSetting.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          });
        }
        await audit(
          {
            action: 'admin.settings.updated',
            entityType: 'clinic_settings',
            metadata: { keys: changed },
          },
          tx,
        );
      });
    }
    return merged;
  }

  // --------------------------------------------------------------- audit log

  /** Newest first, filtered (SPEC §9 `GET /admin/audit-logs`). The view itself is audited. */
  async listAuditLogs(query: AuditLogQuery, audit: RequestAudit): Promise<AuditLogListResponse> {
    const tz = this.deps.timezone;
    const where: Prisma.AuditLogWhereInput = {};

    if (query.actor) {
      if (UUID.test(query.actor)) {
        where.actorUserId = query.actor;
      } else {
        const actor = await this.prisma.user.findUnique({
          where: { email: query.actor },
          select: { id: true },
        });
        // An unknown email matches nothing, rather than everything.
        where.actorUserId = actor?.id ?? '00000000-0000-0000-0000-000000000000';
      }
    }
    if (query.entity) {
      if (UUID.test(query.entity)) where.entityId = query.entity.toLowerCase();
      else where.entityType = query.entity;
    }
    if (query.action) {
      where.action = query.action.endsWith('.')
        ? { startsWith: query.action }
        : { equals: query.action };
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: zonedToUtc(`${query.from}T00:00`, tz) } : {}),
        ...(query.to ? { lt: zonedToUtc(`${addCalendarDays(query.to, 1)}T00:00`, tz) } : {}),
      };
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const actorIds = [...new Set(page.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, email: true },
    });
    const emailById = new Map(actors.map((a) => [a.id, a.email]));

    await audit({
      action: 'admin.audit_logs.viewed',
      entityType: 'audit_logs',
      metadata: {
        filters: Object.entries(query)
          .filter(([k, v]) => k !== 'page' && v !== undefined)
          .map(([k]) => k),
        page: query.page,
      },
    });

    return {
      entries: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        actorUserId: r.actorUserId,
        actorEmail: r.actorUserId ? (emailById.get(r.actorUserId) ?? null) : null,
        entityType: r.entityType,
        entityId: r.entityId,
        ip: r.ip,
        userAgent: r.userAgent,
        metadata: r.metadata,
      })),
      hasMore: rows.length > AUDIT_PAGE_SIZE,
    };
  }
}
