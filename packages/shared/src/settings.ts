import { z } from 'zod';

/**
 * Admin-configurable clinic settings, stored one row per key in
 * `clinic_settings` (SPEC §7.2, §6.2). Defaults apply when a key is absent.
 */
export const clinicSettingsSchema = z.object({
  clinicName: z.string().min(1).max(200),
  clinicAddress: z.string().min(1).max(500),
  clinicPhone: z.string().min(1).max(50),
  /** Label for the national health / insurance identifier (SPEC §6.1). */
  healthIdLabel: z.string().min(1).max(100),
  bookingMinLeadMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
  bookingMaxDaysAhead: z.number().int().min(1).max(365),
  maxFutureAppointmentsPerPatient: z.number().int().min(1).max(50),
  patientChangeCutoffHours: z
    .number()
    .int()
    .min(0)
    .max(14 * 24),
  retentionYears: z.number().int().min(1).max(100),
  /** Current privacy notice & terms version patients consent to at registration. */
  consentVersion: z.string().min(1).max(50),
});
export type ClinicSettings = z.infer<typeof clinicSettingsSchema>;
export type ClinicSettingKey = keyof ClinicSettings;

export const DEFAULT_CLINIC_SETTINGS: ClinicSettings = {
  clinicName: 'Demo Clinic',
  clinicAddress: '1 Example Street, Exampletown, EX1 1AA',
  clinicPhone: '01632 960000',
  healthIdLabel: 'NHS number',
  bookingMinLeadMinutes: 60,
  bookingMaxDaysAhead: 60,
  maxFutureAppointmentsPerPatient: 3,
  patientChangeCutoffHours: 24,
  retentionYears: 8,
  consentVersion: '2026-10-01',
};

/** Public, non-sensitive clinic details for unauthenticated screens. */
export interface PublicClinicInfo {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  consentVersion: string;
  healthIdLabel: string;
}
