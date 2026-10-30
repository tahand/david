import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  appointmentTypeCreateSchema,
  type AdminAppointmentTypeDto,
  type AppointmentTypeCreateInput,
} from '@clinic/shared';
import { adminApi, adminKeys } from '../../api/admin';
import { applyServerErrors } from '../../lib/formErrors';
import { Alert, Button, Checkbox, Spinner, TextField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';

type FormInput = z.input<typeof appointmentTypeCreateSchema>;
const FIELDS = ['name', 'durationMinutes', 'colour'] as const;

function Swatch({ colour }: { colour: string }) {
  // React sets this through the CSSOM, which the CSP's style-src 'self' allows.
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded border border-line-strong"
      style={{ backgroundColor: colour }}
    />
  );
}

/** Create or edit form; `type` absent means create. */
function TypeForm({
  type,
  onDone,
  onCancel,
}: {
  type?: AdminAppointmentTypeDto;
  onDone: (message: string) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, AppointmentTypeCreateInput>({
    resolver: zodResolver(appointmentTypeCreateSchema),
    defaultValues: type ?? {
      name: '',
      durationMinutes: 15,
      colour: '#2563EB',
      patientBookable: true,
      isActive: true,
    },
  });
  const colour = watch('colour');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (type) await adminApi.updateType(type.id, values);
      else await adminApi.createType(values);
      await queryClient.invalidateQueries({ queryKey: adminKeys.types });
      // Booking screens list types too.
      await queryClient.invalidateQueries({ queryKey: ['appointment-types'] });
      if (!type) reset();
      onDone(type ? `Saved "${values.name}".` : `Added "${values.name}".`);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
        <TextField
          label="Length (minutes)"
          type="number"
          inputMode="numeric"
          min={5}
          max={480}
          error={errors.durationMinutes?.message}
          {...register('durationMinutes')}
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label="Colour"
              hint="Hex, e.g. #2563EB"
              error={errors.colour?.message}
              {...register('colour')}
            />
          </div>
          {/^#[0-9a-f]{6}$/i.test(colour ?? '') && (
            <span className="mb-3">
              <Swatch colour={colour!} />
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <Checkbox label="Patients can book this online" {...register('patientBookable')} />
        <Checkbox label="Available for new bookings" {...register('isActive')} />
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {type ? 'Save' : 'Add appointment type'}
        </Button>
      </div>
    </form>
  );
}

/** `/admin/appointment-types` (SPEC §7.1). Types are retired, never deleted, so history stays intact. */
export function AppointmentTypesPage() {
  const query = useQuery({ queryKey: adminKeys.types, queryFn: adminApi.types });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeading>Appointment types</PageHeading>
      <p className="text-ink">
        Changes apply to new bookings. Existing appointments keep the length they were booked with.
      </p>
      <div aria-live="polite">{notice && <Alert tone="success">{notice}</Alert>}</div>

      {query.isPending ? (
        <Spinner label="Loading appointment types" />
      ) : query.isError ? (
        <Alert>We couldn't load appointment types. Please try again.</Alert>
      ) : (
        <ul aria-label="Appointment types" className="rounded-lg border border-line bg-card">
          {query.data.appointmentTypes.map((t) => (
            <li key={t.id} className="border-b border-line px-4 py-3 last:border-0">
              {editing === t.id ? (
                <TypeForm
                  type={t}
                  onCancel={() => setEditing(null)}
                  onDone={(m) => {
                    setEditing(null);
                    setNotice(m);
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="mt-1">
                      <Swatch colour={t.colour} />
                    </span>
                    <div>
                      <p
                        className={`font-medium ${t.isActive ? 'text-ink' : 'text-ink-muted line-through'}`}
                      >
                        {t.name}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {t.durationMinutes} minutes ·{' '}
                        {t.patientBookable ? 'Patients can book online' : 'Staff booking only'}
                        {!t.isActive && ' · Retired'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-11 self-start sm:self-auto"
                    onClick={() => setEditing(t.id)}
                  >
                    Edit<span className="sr-only"> {t.name}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-line bg-card p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-heading">Add an appointment type</h2>
        <TypeForm onDone={setNotice} />
      </section>
    </div>
  );
}
