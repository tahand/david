import type { Role } from './roles.js';

/**
 * Coarse permissions checked by the API's `authorize()` middleware (SPEC §3).
 * Per-record ownership rules (e.g. a patient sees only their own record, a
 * doctor only patients they have appointments with) are enforced in services.
 */
export const PERMISSIONS = [
  'patient:self',
  'patients:read',
  'patients:write',
  'patients:medical:write',
  'doctors:read',
  'availability:manage',
  'appointments:book:self',
  'appointments:book:any',
  'appointments:read',
  'appointments:status',
  'clinical-notes:read',
  'clinical-notes:write',
  'admin:users',
  'admin:settings',
  'admin:appointment-types',
  'admin:audit-logs',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const receptionist: Permission[] = [
  'patients:read',
  'patients:write',
  'patients:medical:write',
  'doctors:read',
  'appointments:book:any',
  'appointments:read',
  'appointments:status',
];

/** Admins and receptionists deliberately lack clinical-notes permissions. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  patient: ['patient:self', 'doctors:read', 'appointments:book:self', 'appointments:read'],
  doctor: [
    'patients:read',
    'patients:medical:write',
    'doctors:read',
    'availability:manage',
    'appointments:read',
    'appointments:status',
    'clinical-notes:read',
    'clinical-notes:write',
  ],
  receptionist,
  admin: [
    ...receptionist,
    'availability:manage',
    'admin:users',
    'admin:settings',
    'admin:appointment-types',
    'admin:audit-logs',
  ],
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);
