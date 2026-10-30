import type { PatientRecord, PatientSearchResponse } from '@clinic/shared';
import { api } from './client';

export const patientKeys = {
  me: ['patients', 'me'] as const,
  search: (search: string, page: number) => ['patients', 'search', search, page] as const,
  detail: (id: string) => ['patients', 'detail', id] as const,
};

/** Data export links; plain same-origin GETs so the browser handles the download. */
export const EXPORT_URLS = {
  json: '/api/patients/me/export?format=json',
  pdf: '/api/patients/me/export?format=pdf',
};

const byId = (id: string) => `/patients/${encodeURIComponent(id)}`;

export const patientsApi = {
  me: () => api.get<PatientRecord>('/patients/me'),
  updateMe: (input: unknown) => api.patch<PatientRecord>('/patients/me', input),
  search: (search: string, page: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set('search', search);
    return api.get<PatientSearchResponse>(`/patients?${params}`);
  },
  get: (id: string) => api.get<PatientRecord>(byId(id)),
  create: (input: unknown) => api.post<PatientRecord>('/patients', input),
  update: (id: string, input: unknown) => api.patch<PatientRecord>(byId(id), input),
  replaceMedicalSummary: (id: string, input: unknown) =>
    api.put<PatientRecord>(`${byId(id)}/medical-summary`, input),
};
