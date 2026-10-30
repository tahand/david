import { z } from 'zod';
import { dateOfBirthSchema, emailSchema, phoneSchema } from './auth.js';

/**
 * Patient record schemas (SPEC §6.1). Optional text fields accept `null` or an
 * empty string to clear a value; `undefined` (absent) leaves it unchanged on
 * PATCH. Unknown fields are stripped.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

const blankToNull = (v: string | null | undefined) => (v?.trim() === '' ? null : v);

const optionalPhone = z.string().nullish().transform(blankToNull).pipe(phoneSchema.nullish());
const optionalEmail = z.string().nullish().transform(blankToNull).pipe(emailSchema.nullish());
const optionalDate = z
  .string()
  .nullish()
  .transform(blankToNull)
  .pipe(z.iso.date({ message: 'Enter a valid date' }).nullish());

/** Inside nested objects an absent optional field is stored as null, never dropped. */
const orNull = <T extends z.ZodType>(schema: T) =>
  schema.transform((v) => (v === undefined ? null : v) as Exclude<z.output<T>, undefined>);

export const SEX_AT_BIRTH = ['female', 'male', 'intersex', 'not_stated'] as const;
export const sexAtBirthSchema = z.enum(SEX_AT_BIRTH);
export type SexAtBirth = z.infer<typeof sexAtBirthSchema>;

export const PREFERRED_CONTACT = ['email', 'sms', 'phone'] as const;
export const preferredContactSchema = z.enum(PREFERRED_CONTACT);
export type PreferredContact = z.infer<typeof preferredContactSchema>;

export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'unknown'] as const;

export const allergySchema = z.object({
  substance: z.string().trim().min(1, 'Enter the substance').max(200),
  reaction: orNull(optionalText(500)),
  severity: z.enum(ALLERGY_SEVERITIES).default('unknown'),
});
export type Allergy = z.output<typeof allergySchema>;

export const medicationSchema = z.object({
  name: z.string().trim().min(1, 'Enter the medication').max(200),
  dose: orNull(optionalText(100)),
  frequency: orNull(optionalText(100)),
});
export type Medication = z.output<typeof medicationSchema>;

export const conditionSchema = z.object({
  condition: z.string().trim().min(1, 'Enter the condition').max(200),
  diagnosedDate: orNull(optionalDate),
  notes: orNull(optionalText(1000)),
});
export type Condition = z.output<typeof conditionSchema>;

/** The encrypted `medical_summary_enc` payload. */
export const medicalSummarySchema = z.object({
  allergies: z.array(allergySchema).max(50).default([]),
  medications: z.array(medicationSchema).max(50).default([]),
  conditions: z.array(conditionSchema).max(50).default([]),
});
export type MedicalSummary = z.output<typeof medicalSummarySchema>;

export const gpDetailsSchema = z.object({
  name: orNull(optionalText(200)),
  practice: orNull(optionalText(200)),
  phone: orNull(optionalPhone),
});
export type GpDetails = z.output<typeof gpDetailsSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(200),
  relationship: z.string().trim().min(1, 'Enter the relationship').max(100),
  phone: phoneSchema,
  email: orNull(optionalEmail),
});
export type EmergencyContact = z.output<typeof emergencyContactSchema>;

const personalFields = {
  title: optionalText(20),
  firstName: z.string().trim().min(1, 'Enter a first name').max(100),
  middleNames: optionalText(200),
  lastName: z.string().trim().min(1, 'Enter a last name').max(100),
  preferredName: optionalText(100),
  dateOfBirth: dateOfBirthSchema,
  sexAtBirth: sexAtBirthSchema.nullish(),
  genderIdentity: optionalText(100),
  pronouns: optionalText(50),
  healthId: optionalText(50),
  preferredLanguage: optionalText(50),
  interpreterRequired: z.boolean().optional(),
};

const contactFields = {
  phoneMobile: optionalPhone,
  phoneAlt: optionalPhone,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postcode: optionalText(20),
  country: optionalText(100),
  preferredContact: preferredContactSchema.optional(),
  reminderConsent: z.boolean().optional(),
};

const emergencyContactField = { emergencyContact: emergencyContactSchema.nullish() };

/** PATCH /patients/me — patients edit personal, contact and emergency contact details. */
export const patientSelfUpdateSchema = z
  .object({ ...personalFields, ...contactFields, ...emergencyContactField })
  .partial();
export type PatientSelfUpdateInput = z.input<typeof patientSelfUpdateSchema>;

/** PATCH /patients/:id — staff may also set a contact email for patients without a login. */
export const patientStaffUpdateSchema = patientSelfUpdateSchema.extend({
  contactEmail: optionalEmail,
});
export type PatientStaffUpdateInput = z.input<typeof patientStaffUpdateSchema>;

/** POST /patients — receptionist/admin creates a record (no login). */
export const patientCreateSchema = z.object({
  ...personalFields,
  ...contactFields,
  ...emergencyContactField,
  contactEmail: optionalEmail,
});
export type PatientCreateInput = z.input<typeof patientCreateSchema>;

/** PUT /patients/:id/medical-summary — replaces the whole medical section. */
export const medicalSummaryUpdateSchema = medicalSummarySchema.extend({
  gpDetails: gpDetailsSchema.nullish(),
  accessibilityNeeds: optionalText(2000),
});
export type MedicalSummaryUpdateInput = z.input<typeof medicalSummaryUpdateSchema>;

export const PATIENT_SEARCH_PAGE_SIZE = 20;

export const patientSearchQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const exportFormatSchema = z.object({
  format: z.enum(['json', 'pdf']).default('json'),
});

/** Full patient record as returned to authorised callers. */
export interface PatientRecord {
  id: string;
  hasLogin: boolean;
  /** Login email, or the contact email for patients without a login. */
  email: string | null;
  title: string | null;
  firstName: string;
  middleNames: string | null;
  lastName: string;
  preferredName: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  sexAtBirth: SexAtBirth | null;
  genderIdentity: string | null;
  pronouns: string | null;
  healthId: string | null;
  preferredLanguage: string | null;
  interpreterRequired: boolean;
  phoneMobile: string | null;
  phoneAlt: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  preferredContact: PreferredContact;
  reminderConsent: boolean;
  emergencyContact: EmergencyContact | null;
  medicalSummary: MedicalSummary;
  gpDetails: GpDetails | null;
  accessibilityNeeds: string | null;
  consentVersion: string | null;
  consentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Search result row: searchable, non-sensitive fields only. */
export interface PatientSummary {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string;
  postcode: string | null;
  phoneMobile: string | null;
  hasLogin: boolean;
}

export interface PatientSearchResponse {
  patients: PatientSummary[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PatientExportAppointment {
  startsAt: string;
  endsAt: string;
  status: string;
  doctor: string;
  appointmentType: string;
  reasonForVisit: string | null;
  cancelledReason: string | null;
  bookedAt: string;
}

/** GET /patients/me/export (SPEC §6.2 data subject access). */
export interface PatientExport {
  generatedAt: string;
  clinic: string;
  /** What `profile.healthId` is called at this clinic (e.g. "NHS number"). */
  healthIdLabel: string;
  account: {
    email: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  profile: PatientRecord;
  appointments: PatientExportAppointment[];
}
