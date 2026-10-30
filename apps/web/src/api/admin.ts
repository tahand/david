import type {
  AdminAppointmentTypeDto,
  AdminUserDto,
  AdminUserListResponse,
  AuditLogListResponse,
  ClinicSettings,
} from '@clinic/shared';
import { api } from './client';

export interface UserFilters {
  q?: string;
  role?: string;
  status?: string;
  page: number;
}

export interface AuditFilters {
  actor?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
}

/** Query string with empty values dropped; `page=1` is implied. */
function toQuery(filters: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === '' || (k === 'page' && v === 1)) continue;
    params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export const adminKeys = {
  users: (f: UserFilters) => ['admin', 'users', f] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  types: ['admin', 'appointment-types'] as const,
  settings: ['admin', 'settings'] as const,
  audit: (f: AuditFilters) => ['admin', 'audit', f] as const,
};

const user = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

export const adminApi = {
  users: (f: UserFilters) => api.get<AdminUserListResponse>(`/admin/users${toQuery(f)}`),
  user: (id: string) => api.get<AdminUserDto>(user(id)),
  createStaff: (input: unknown) => api.post<AdminUserDto>('/admin/users', input),
  updateUser: (id: string, input: unknown) => api.patch<AdminUserDto>(user(id), input),
  forcePasswordReset: (id: string) => api.post<AdminUserDto>(`${user(id)}/password-reset`),
  resetMfa: (id: string) => api.post<AdminUserDto>(`${user(id)}/mfa-reset`),

  types: () => api.get<{ appointmentTypes: AdminAppointmentTypeDto[] }>('/admin/appointment-types'),
  createType: (input: unknown) =>
    api.post<AdminAppointmentTypeDto>('/admin/appointment-types', input),
  updateType: (id: string, input: unknown) =>
    api.patch<AdminAppointmentTypeDto>(`/admin/appointment-types/${encodeURIComponent(id)}`, input),

  settings: () => api.get<ClinicSettings>('/admin/settings'),
  updateSettings: (input: Partial<ClinicSettings>) =>
    api.put<ClinicSettings>('/admin/settings', input),

  auditLogs: (f: AuditFilters) => api.get<AuditLogListResponse>(`/admin/audit-logs${toQuery(f)}`),
};
