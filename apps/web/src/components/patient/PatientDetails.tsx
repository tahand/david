import { useState } from 'react';
import { useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  PREFERRED_CONTACT,
  SEX_AT_BIRTH,
  emergencyContactSchema,
  patientCreateSchema,
  preferredContactSchema,
  type PatientRecord,
} from '@clinic/shared';
import { applyServerErrors } from '../../lib/formErrors';
import { formatDate } from '../../lib/format';
import { Alert, Button, Checkbox, SelectField, TextField } from '../forms';
import { DetailList } from './DetailList';

const SEX_LABELS: Record<(typeof SEX_AT_BIRTH)[number], string> = {
  female: 'Female',
  male: 'Male',
  intersex: 'Intersex',
  not_stated: 'Prefer not to say',
};
const CONTACT_LABELS: Record<(typeof PREFERRED_CONTACT)[number], string> = {
  email: 'Email',
  sms: 'Text message',
  phone: 'Phone call',
};

const address = (p: PatientRecord) =>
  [p.addressLine1, p.addressLine2, p.city, p.region, p.postcode, p.country]
    .filter(Boolean)
    .join(', ');

/** Personal, contact and emergency contact details (SPEC §6.1), read-only. */
export function PatientDetailsView({
  patient: p,
  healthIdLabel,
}: {
  patient: PatientRecord;
  healthIdLabel: string;
}) {
  const ec = p.emergencyContact;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-3 font-semibold text-slate-900">Personal</h3>
        <DetailList
          items={[
            ['Name', [p.title, p.firstName, p.middleNames, p.lastName].filter(Boolean).join(' ')],
            ['Preferred name', p.preferredName],
            ['Date of birth', formatDate(p.dateOfBirth)],
            ['Sex at birth', p.sexAtBirth && SEX_LABELS[p.sexAtBirth]],
            ['Gender identity', p.genderIdentity],
            ['Pronouns', p.pronouns],
            [healthIdLabel, p.healthId],
            ['Preferred language', p.preferredLanguage],
            ['Interpreter required', p.interpreterRequired ? 'Yes' : 'No'],
          ]}
        />
      </div>
      <div>
        <h3 className="mb-3 font-semibold text-slate-900">Contact</h3>
        <DetailList
          items={[
            ['Email', p.email],
            ['Mobile phone', p.phoneMobile],
            ['Other phone', p.phoneAlt],
            ['Address', address(p)],
            ['Preferred contact', CONTACT_LABELS[p.preferredContact]],
            ['Appointment reminders', p.reminderConsent ? 'Yes' : 'No'],
          ]}
        />
      </div>
      <div>
        <h3 className="mb-3 font-semibold text-slate-900">Emergency contact</h3>
        {ec ? (
          <DetailList
            items={[
              ['Name', ec.name],
              ['Relationship', ec.relationship],
              ['Phone', ec.phone],
              ['Email', ec.email],
            ]}
          />
        ) : (
          <p className="text-slate-600 italic">Not recorded</p>
        )}
      </div>
    </div>
  );
}

const BLANK_CONTACT = { name: '', relationship: '', phone: '', email: '' };
type ContactInput = typeof BLANK_CONTACT;
const isBlank = (c: ContactInput) => Object.values(c).every((v) => v.trim() === '');

/** All four emergency contact fields blank means "no emergency contact". */
const emergencyContactField = z
  .object({ name: z.string(), relationship: z.string(), phone: z.string(), email: z.string() })
  .superRefine((v, ctx) => {
    if (isBlank(v)) return;
    const result = emergencyContactSchema.safeParse(v);
    for (const issue of result.error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  })
  .transform((v) => (isBlank(v) ? null : emergencyContactSchema.parse(v)));

const formSchema = patientCreateSchema.extend({
  sexAtBirth: z.enum(['', ...SEX_AT_BIRTH]).transform((v) => (v === '' ? null : v)),
  emergencyContact: emergencyContactField,
  preferredContact: preferredContactSchema,
  interpreterRequired: z.boolean(),
  reminderConsent: z.boolean(),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const FIELDS: Path<FormInput>[] = [
  'title',
  'firstName',
  'middleNames',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'sexAtBirth',
  'genderIdentity',
  'pronouns',
  'healthId',
  'preferredLanguage',
  'contactEmail',
  'phoneMobile',
  'phoneAlt',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postcode',
  'country',
  'emergencyContact.name',
  'emergencyContact.relationship',
  'emergencyContact.phone',
  'emergencyContact.email',
];

function toFormValues(p?: PatientRecord): FormInput {
  const ec = p?.emergencyContact;
  return {
    title: p?.title ?? '',
    firstName: p?.firstName ?? '',
    middleNames: p?.middleNames ?? '',
    lastName: p?.lastName ?? '',
    preferredName: p?.preferredName ?? '',
    dateOfBirth: p?.dateOfBirth ?? '',
    sexAtBirth: p?.sexAtBirth ?? '',
    genderIdentity: p?.genderIdentity ?? '',
    pronouns: p?.pronouns ?? '',
    healthId: p?.healthId ?? '',
    preferredLanguage: p?.preferredLanguage ?? '',
    interpreterRequired: p?.interpreterRequired ?? false,
    contactEmail: p && !p.hasLogin ? (p.email ?? '') : '',
    phoneMobile: p?.phoneMobile ?? '',
    phoneAlt: p?.phoneAlt ?? '',
    addressLine1: p?.addressLine1 ?? '',
    addressLine2: p?.addressLine2 ?? '',
    city: p?.city ?? '',
    region: p?.region ?? '',
    postcode: p?.postcode ?? '',
    country: p?.country ?? '',
    preferredContact: p?.preferredContact ?? 'email',
    reminderConsent: p?.reminderConsent ?? false,
    emergencyContact: ec ? { ...ec, email: ec.email ?? '' } : BLANK_CONTACT,
  };
}

/**
 * Create/edit form for personal, contact and emergency contact details.
 * `showContactEmail` is for staff editing patients who have no login; a
 * patient's login email is changed through their account, not here.
 */
export function PatientDetailsForm({
  patient,
  healthIdLabel,
  showContactEmail,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  patient?: PatientRecord;
  healthIdLabel: string;
  showContactEmail: boolean;
  submitLabel: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(patient),
  });

  const submit = handleSubmit(async ({ contactEmail, ...values }) => {
    setFormError(null);
    try {
      await onSubmit(showContactEmail ? { ...values, contactEmail } : values);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  const ec = errors.emergencyContact;
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-semibold text-slate-900">Personal</legend>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
          <TextField
            label="Title (optional)"
            autoComplete="honorific-prefix"
            error={errors.title?.message}
            {...register('title')}
          />
          <TextField
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <TextField
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Middle names (optional)"
            autoComplete="additional-name"
            error={errors.middleNames?.message}
            {...register('middleNames')}
          />
          <TextField
            label="Preferred name (optional)"
            autoComplete="nickname"
            error={errors.preferredName?.message}
            {...register('preferredName')}
          />
          <TextField
            label="Date of birth"
            type="date"
            autoComplete="bday"
            error={errors.dateOfBirth?.message}
            {...register('dateOfBirth')}
          />
          <SelectField
            label="Sex at birth (optional)"
            options={[
              { value: '', label: 'Not recorded' },
              ...SEX_AT_BIRTH.map((v) => ({ value: v, label: SEX_LABELS[v] })),
            ]}
            error={errors.sexAtBirth?.message}
            {...register('sexAtBirth')}
          />
          <TextField
            label="Gender identity (optional)"
            error={errors.genderIdentity?.message}
            {...register('genderIdentity')}
          />
          <TextField
            label="Pronouns (optional)"
            error={errors.pronouns?.message}
            {...register('pronouns')}
          />
          <TextField
            label={`${healthIdLabel} (optional)`}
            autoComplete="off"
            error={errors.healthId?.message}
            {...register('healthId')}
          />
          <TextField
            label="Preferred language (optional)"
            autoComplete="language"
            error={errors.preferredLanguage?.message}
            {...register('preferredLanguage')}
          />
        </div>
        <Checkbox label="An interpreter is required" {...register('interpreterRequired')} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-semibold text-slate-900">Contact</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {showContactEmail && (
            <TextField
              label="Email (optional)"
              type="email"
              autoComplete="email"
              error={errors.contactEmail?.message}
              {...register('contactEmail')}
            />
          )}
          <TextField
            label="Mobile phone (optional)"
            type="tel"
            autoComplete="tel"
            error={errors.phoneMobile?.message}
            {...register('phoneMobile')}
          />
          <TextField
            label="Other phone (optional)"
            type="tel"
            error={errors.phoneAlt?.message}
            {...register('phoneAlt')}
          />
          <TextField
            label="Address line 1 (optional)"
            autoComplete="address-line1"
            error={errors.addressLine1?.message}
            {...register('addressLine1')}
          />
          <TextField
            label="Address line 2 (optional)"
            autoComplete="address-line2"
            error={errors.addressLine2?.message}
            {...register('addressLine2')}
          />
          <TextField
            label="Town or city (optional)"
            autoComplete="address-level2"
            error={errors.city?.message}
            {...register('city')}
          />
          <TextField
            label="County or state (optional)"
            autoComplete="address-level1"
            error={errors.region?.message}
            {...register('region')}
          />
          <TextField
            label="Postcode (optional)"
            autoComplete="postal-code"
            error={errors.postcode?.message}
            {...register('postcode')}
          />
          <TextField
            label="Country (optional)"
            autoComplete="country-name"
            error={errors.country?.message}
            {...register('country')}
          />
          <SelectField
            label="Preferred contact method"
            options={PREFERRED_CONTACT.map((v) => ({ value: v, label: CONTACT_LABELS[v] }))}
            error={errors.preferredContact?.message}
            {...register('preferredContact')}
          />
        </div>
        <Checkbox label="Send appointment reminders" {...register('reminderConsent')} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-semibold text-slate-900">Emergency contact (optional)</legend>
        <p className="text-sm text-slate-700">Leave all four fields blank if there is no one.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Contact name"
            error={ec?.name?.message}
            {...register('emergencyContact.name')}
          />
          <TextField
            label="Relationship"
            error={ec?.relationship?.message}
            {...register('emergencyContact.relationship')}
          />
          <TextField
            label="Contact phone"
            type="tel"
            error={ec?.phone?.message}
            {...register('emergencyContact.phone')}
          />
          <TextField
            label="Contact email (optional)"
            type="email"
            error={ec?.email?.message}
            {...register('emergencyContact.email')}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
