import { z } from 'zod';
import { emailSchema } from './auth.js';
import { roleSchema, type Role } from './roles.js';
import { clinicSettingsSchema } from './settings.js';

/**
 * Admin schemas (SPEC §9 Admin). Staff accounts are created here only; there
 * is no public sign-up for staff (SPEC §3).
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const STAFF_ROLES_LIST = ['doctor', 'receptionist', 'admin'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES_LIST);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const doctorProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter the name patients will see').max(120),
  specialty: optionalText(120),
  registrationNumber: optionalText(50),
  bio: optionalText(2000),
  isBookable: z.boolean().optional(),
});
export type DoctorProfileInput = z.infer<typeof doctorProfileSchema>;

export const staffCreateSchema = z
  .object({
    email: emailSchema,
    role: staffRoleSchema,
    doctor: doctorProfileSchema.optional(),
  })
  .refine((v) => v.role !== 'doctor' || v.doctor, {
    path: ['doctor', 'displayName'],
    message: 'Enter the name patients will see',
  });
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const userUpdateSchema = z
  .object({
    role: staffRoleSchema.optional(),
    isActive: z.boolean().optional(),
    doctor: doctorProfileSchema.partial().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined || v.doctor !== undefined, {
    message: 'Nothing to change',
  });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const USER_STATUS = ['active', 'inactive'] as const;

export const userListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  status: z.enum(USER_STATUS).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export interface AdminDoctorProfile {
  id: string;
  displayName: string;
  specialty: string | null;
  registrationNumber: string | null;
  bio: string | null;
  isBookable: boolean;
}

export interface AdminUserDto {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** True until the person has chosen a password from their invitation. */
  invitePending: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  doctor: AdminDoctorProfile | null;
}

export interface AdminUserListResponse {
  users: AdminUserDto[];
  hasMore: boolean;
}

// ---------------------------------------------------------------- appointment types

const colourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #2563EB');

export const appointmentTypeCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  durationMinutes: z.coerce
    .number({ message: 'Enter the length in minutes' })
    .int('Use whole minutes')
    .min(5, 'At least 5 minutes')
    .max(480, 'At most 8 hours'),
  colour: colourSchema,
  patientBookable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type AppointmentTypeCreateInput = z.infer<typeof appointmentTypeCreateSchema>;

export const appointmentTypeUpdateSchema = z
  .object({
    name: appointmentTypeCreateSchema.shape.name.optional(),
    durationMinutes: appointmentTypeCreateSchema.shape.durationMinutes.optional(),
    colour: colourSchema.optional(),
    patientBookable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
export type AppointmentTypeUpdateInput = z.infer<typeof appointmentTypeUpdateSchema>;

export interface AdminAppointmentTypeDto {
  id: string;
  name: string;
  durationMinutes: number;
  colour: string;
  patientBookable: boolean;
  isActive: boolean;
}

// ---------------------------------------------------------------- settings

/** Partial update: only the keys sent are changed; the merged result must be valid. */
export const settingsUpdateSchema = clinicSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

// ---------------------------------------------------------------- audit log

const dateParam = z.iso.date({ message: 'Use a date like 2026-11-03' });

export const auditLogQuerySchema = z
  .object({
    /** User ID or email address of whoever performed the action. */
    actor: z.string().trim().max(254).optional(),
    /** Entity ID (uuid) or entity type such as `patient`. */
    entity: z.string().trim().max(100).optional(),
    /** Action, or an action prefix ending in `.` such as `auth.`. */
    action: z.string().trim().max(100).optional(),
    /** Inclusive calendar dates in clinic time. */
    from: dateParam.optional(),
    to: dateParam.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogDto {
  id: string;
  createdAt: string;
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
}

export interface AuditLogListResponse {
  entries: AuditLogDto[];
  hasMore: boolean;
}
