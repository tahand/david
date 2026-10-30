import { z } from 'zod';
import {
  exportFormatSchema,
  medicalSummaryUpdateSchema,
  patientCreateSchema,
  patientSearchQuerySchema,
  patientSelfUpdateSchema,
  patientStaffUpdateSchema,
} from '@clinic/shared';

export {
  exportFormatSchema,
  medicalSummaryUpdateSchema,
  patientCreateSchema,
  patientSearchQuerySchema,
  patientSelfUpdateSchema,
  patientStaffUpdateSchema,
};

export type PatientCreate = z.output<typeof patientCreateSchema>;
export type PatientStaffUpdate = z.output<typeof patientStaffUpdateSchema>;
export type MedicalSummaryUpdate = z.output<typeof medicalSummaryUpdateSchema>;
export type PatientSearchQuery = z.output<typeof patientSearchQuerySchema>;

/** A malformed ID can't name a record, so it is a 404 rather than a validation error. */
export function parsePatientId(raw: string): string | null {
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}
