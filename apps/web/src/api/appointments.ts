import type {
  AppointmentDetail,
  AppointmentDto,
  AppointmentListQuery,
  AppointmentListResponse,
  AppointmentTypeDto,
  BookingCreateInput,
  CancelInput,
  ClinicalNoteCreateInput,
  ClinicalNoteDto,
  RescheduleInput,
  StatusUpdateInput,
} from '@clinic/shared';
import { api } from './client';

export const appointmentKeys = {
  all: ['appointments'] as const,
  list: (query: AppointmentListQuery) => ['appointments', 'list', query] as const,
  detail: (id: string) => ['appointments', 'detail', id] as const,
  notes: (id: string) => ['appointments', 'notes', id] as const,
  types: ['appointment-types'] as const,
};

const byId = (id: string) => `/appointments/${encodeURIComponent(id)}`;

function listPath(query: AppointmentListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/appointments?${qs}` : '/appointments';
}

export const appointmentsApi = {
  types: async () =>
    (await api.get<{ appointmentTypes: AppointmentTypeDto[] }>('/appointment-types'))
      .appointmentTypes,
  list: (query: AppointmentListQuery = {}) => api.get<AppointmentListResponse>(listPath(query)),
  get: (id: string) => api.get<AppointmentDetail>(byId(id)),
  book: (input: BookingCreateInput) => api.post<AppointmentDto>('/appointments', input),
  reschedule: (id: string, input: RescheduleInput) =>
    api.patch<AppointmentDto>(`${byId(id)}/reschedule`, input),
  cancel: (id: string, input: CancelInput) =>
    api.patch<AppointmentDto>(`${byId(id)}/cancel`, input),
  updateStatus: (id: string, input: StatusUpdateInput) =>
    api.patch<AppointmentDto>(`${byId(id)}/status`, input),
  notes: async (id: string) =>
    (await api.get<{ notes: ClinicalNoteDto[] }>(`${byId(id)}/notes`)).notes,
  addNote: (id: string, input: ClinicalNoteCreateInput) =>
    api.post<ClinicalNoteDto>(`${byId(id)}/notes`, input),
};
