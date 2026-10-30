import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { clinicSettingsSchema, THEMES, type ClinicSettings } from '@clinic/shared';
import { adminApi, adminKeys } from '../../api/admin';
import { applyServerErrors } from '../../lib/formErrors';
import { Alert, Button, SelectField, Spinner, TextField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';

// Number inputs arrive as strings; coerce them for the shared schema.
const formSchema = clinicSettingsSchema.extend({
  bookingMinLeadMinutes: z.coerce.number().pipe(clinicSettingsSchema.shape.bookingMinLeadMinutes),
  bookingMaxDaysAhead: z.coerce.number().pipe(clinicSettingsSchema.shape.bookingMaxDaysAhead),
  maxFutureAppointmentsPerPatient: z.coerce
    .number()
    .pipe(clinicSettingsSchema.shape.maxFutureAppointmentsPerPatient),
  patientChangeCutoffHours: z.coerce
    .number()
    .pipe(clinicSettingsSchema.shape.patientChangeCutoffHours),
  retentionYears: z.coerce.number().pipe(clinicSettingsSchema.shape.retentionYears),
});
type FormInput = z.input<typeof formSchema>;
const FIELDS = Object.keys(clinicSettingsSchema.shape) as (keyof ClinicSettings)[];

const THEME_OPTIONS = THEMES.map((t) => ({ value: t.id, label: t.label }));

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 sm:p-6">
      <legend className="px-1 text-lg font-semibold text-heading">{legend}</legend>
      {children}
    </fieldset>
  );
}

function SettingsForm({ settings }: { settings: ClinicSettings }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormInput, unknown, ClinicSettings>({
    resolver: zodResolver(formSchema),
    defaultValues: settings,
  });

  const onSubmit = handleSubmit(async (values) => {
    setMessage(null);
    setFormError(null);
    // Send only what changed, so two admins editing different settings don't clash.
    const changed = Object.fromEntries(
      FIELDS.filter((k) => dirtyFields[k]).map((k) => [k, values[k]]),
    ) as Partial<ClinicSettings>;
    if (Object.keys(changed).length === 0) return setMessage('Nothing to change.');
    try {
      const saved = await adminApi.updateSettings(changed);
      queryClient.setQueryData(adminKeys.settings, saved);
      // Branding, theme and booking rules are read elsewhere.
      await queryClient.invalidateQueries({ queryKey: ['clinic'] });
      reset(saved);
      setMessage('Settings saved.');
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  const num = (name: keyof ClinicSettings, label: string, hint: string) => (
    <TextField
      label={label}
      hint={hint}
      type="number"
      inputMode="numeric"
      error={errors[name]?.message}
      {...register(name)}
    />
  );

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <div aria-live="polite">
        {message && <Alert tone="success">{message}</Alert>}
        {formError && <Alert>{formError}</Alert>}
      </div>
      <Fieldset legend="Clinic">
        <TextField
          label="Clinic name"
          error={errors.clinicName?.message}
          {...register('clinicName')}
        />
        <TextField
          label="Address"
          hint="Shown in emails and calendar invitations"
          error={errors.clinicAddress?.message}
          {...register('clinicAddress')}
        />
        <TextField
          label="Phone"
          type="tel"
          error={errors.clinicPhone?.message}
          {...register('clinicPhone')}
        />
        <TextField
          label="Health ID label"
          hint="For example, NHS number or Insurance policy number"
          error={errors.healthIdLabel?.message}
          {...register('healthIdLabel')}
        />
        <SelectField
          label="Colour theme"
          options={THEME_OPTIONS}
          error={errors.theme?.message}
          {...register('theme')}
        />
      </Fieldset>
      <Fieldset legend="Booking rules">
        <div className="grid gap-4 sm:grid-cols-2">
          {num(
            'bookingMinLeadMinutes',
            'Earliest booking (minutes ahead)',
            'e.g. 60 = at least an hour ahead',
          )}
          {num('bookingMaxDaysAhead', 'Latest booking (days ahead)', 'e.g. 60')}
          {num(
            'maxFutureAppointmentsPerPatient',
            'Upcoming appointments per patient',
            'Applies when patients book themselves',
          )}
          {num(
            'patientChangeCutoffHours',
            'Patient change cut-off (hours)',
            'After this, patients must call the clinic',
          )}
        </div>
      </Fieldset>
      <Fieldset legend="Records">
        <div className="grid gap-4 sm:grid-cols-2">
          {num(
            'retentionYears',
            'Keep deleted records for (years)',
            'Then they are permanently erased',
          )}
          <TextField
            label="Privacy notice and terms version"
            hint="Change when you publish new terms; recorded with each patient's consent"
            error={errors.consentVersion?.message}
            {...register('consentVersion')}
          />
        </div>
      </Fieldset>
      <Button type="submit" loading={isSubmitting} className="self-start">
        Save settings
      </Button>
    </form>
  );
}

/** `/admin/settings` (SPEC §9 `GET/PUT /admin/settings`). */
export function SettingsPage() {
  const query = useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading>Clinic settings</PageHeading>
      {query.isPending ? (
        <Spinner label="Loading settings" />
      ) : query.isError ? (
        <Alert>We couldn't load settings. Please try again.</Alert>
      ) : (
        <SettingsForm settings={query.data} />
      )}
    </div>
  );
}
