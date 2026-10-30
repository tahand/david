import { z } from 'zod';

export const ROLES = ['patient', 'doctor', 'receptionist', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles that must enrol in MFA before reaching any page (SPEC §4.1). */
export const STAFF_ROLES: readonly Role[] = ['doctor', 'receptionist', 'admin'];

export const isStaffRole = (role: Role): boolean => STAFF_ROLES.includes(role);
