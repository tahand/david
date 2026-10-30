import type { Role } from '@clinic/shared';

export const ROLE_LABELS: Record<Role, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  admin: 'Admin',
};

export const STAFF_ROLE_OPTIONS = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'admin', label: 'Admin' },
] as const;

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const formatInstant = (iso: string | null): string =>
  iso ? dateTime.format(new Date(iso)) : '—';
