import type {
  AvailabilityExceptionDto,
  AvailabilityResponse,
  AvailabilityUpdateInput,
  DoctorProfile,
  ExceptionCreateInput,
  SlotsResponse,
} from '@clinic/shared';
import { api } from './client';

export const doctorKeys = {
  list: ['doctors', 'list'] as const,
  me: ['doctors', 'me'] as const,
  availability: (id: string) => ['doctors', 'availability', id] as const,
  slots: (id: string, typeId: string, from: string, to: string) =>
    ['doctors', 'slots', id, typeId, from, to] as const,
};

const byId = (id: string) => `/doctors/${encodeURIComponent(id)}`;

export const doctorsApi = {
  list: async () => (await api.get<{ doctors: DoctorProfile[] }>('/doctors')).doctors,
  me: () => api.get<DoctorProfile>('/doctors/me'),
  availability: (id: string) => api.get<AvailabilityResponse>(`${byId(id)}/availability`),
  replaceAvailability: (id: string, input: AvailabilityUpdateInput) =>
    api.put<AvailabilityResponse>(`${byId(id)}/availability`, input),
  addException: (id: string, input: ExceptionCreateInput) =>
    api.post<AvailabilityExceptionDto>(`${byId(id)}/exceptions`, input),
  deleteException: (id: string, exceptionId: string) =>
    api.delete<void>(`${byId(id)}/exceptions/${encodeURIComponent(exceptionId)}`),
  slots: (id: string, typeId: string, from: string, to: string) =>
    api.get<SlotsResponse>(
      `${byId(id)}/slots?${new URLSearchParams({ from, to, typeId }).toString()}`,
    ),
};
