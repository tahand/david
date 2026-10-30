import { useState } from 'react';
import { useFieldArray, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ALLERGY_SEVERITIES, medicalSummaryUpdateSchema, type PatientRecord } from '@clinic/shared';
import { ApiError } from '../../api/client';
import { applyServerErrors } from '../../lib/formErrors';
import { formatDate } from '../../lib/format';
import { Alert, Button, SelectField, TextAreaField, TextField } from '../forms';
import { DetailList } from './DetailList';

const SEVERITY_LABELS: Record<(typeof ALLERGY_SEVERITIES)[number], string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  unknown: 'Severity unknown',
};

const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

function ItemList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-slate-900">{label}</h3>
      {items.length === 0 ? (
        <p className="text-slate-600 italic">None recorded</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-slate-900">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Medical summary (SPEC §6.1), read-only. */
export function MedicalSummaryView({ patient: p }: { patient: PatientRecord }) {
  const { allergies, medications, conditions } = p.medicalSummary;
  return (
    <div className="flex flex-col gap-5">
      <ItemList
        label="Allergies"
        items={allergies.map((a) => joined(a.substance, a.reaction, SEVERITY_LABELS[a.severity]))}
      />
      <ItemList
        label="Current medications"
        items={medications.map((m) => joined(m.name, m.dose, m.frequency))}
      />
      <ItemList
        label="Long-term conditions"
        items={conditions.map((c) =>
          joined(
            c.condition,
            c.diagnosedDate && `diagnosed ${formatDate(c.diagnosedDate)}`,
            c.notes,
          ),
        )}
      />
      <DetailList
        items={[
          ['GP', p.gpDetails && joined(p.gpDetails.name, p.gpDetails.practice, p.gpDetails.phone)],
          ['Accessibility needs', p.accessibilityNeeds],
        ]}
      />
    </div>
  );
}

type FormInput = z.input<typeof medicalSummaryUpdateSchema>;
type FormOutput = z.output<typeof medicalSummaryUpdateSchema>;

const toFormValues = (p: PatientRecord): FormInput => ({
  allergies: p.medicalSummary.allergies.map((a) => ({ ...a, reaction: a.reaction ?? '' })),
  medications: p.medicalSummary.medications.map((m) => ({
    name: m.name,
    dose: m.dose ?? '',
    frequency: m.frequency ?? '',
  })),
  conditions: p.medicalSummary.conditions.map((c) => ({
    condition: c.condition,
    diagnosedDate: c.diagnosedDate ?? '',
    notes: c.notes ?? '',
  })),
  gpDetails: {
    name: p.gpDetails?.name ?? '',
    practice: p.gpDetails?.practice ?? '',
    phone: p.gpDetails?.phone ?? '',
  },
  accessibilityNeeds: p.accessibilityNeeds ?? '',
});

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="link"
      className="min-h-11 self-start text-sm sm:min-h-0 sm:self-end sm:pb-2.5"
      onClick={onClick}
    >
      Remove<span className="sr-only"> {label}</span>
    </Button>
  );
}

/** Each repeated entry is a bordered card on phones and a plain grid row from `sm` up. */
const ROW = 'grid gap-3 rounded-md border border-slate-200 p-3 sm:border-0 sm:p-0';

/** Replaces the whole medical section (doctors and reception only). */
export function MedicalSummaryForm({
  patient,
  onSubmit,
  onCancel,
}: {
  patient: PatientRecord;
  onSubmit: (values: FormOutput) => Promise<void>;
  onCancel: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(medicalSummaryUpdateSchema),
    defaultValues: toFormValues(patient),
  });
  const allergies = useFieldArray({ control, name: 'allergies' });
  const medications = useFieldArray({ control, name: 'medications' });
  const conditions = useFieldArray({ control, name: 'conditions' });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      // Server paths (e.g. allergies.0.substance) are the same as the input names.
      const paths = err instanceof ApiError ? err.details.map((d) => d.path ?? '') : [];
      setFormError(applyServerErrors(err, setError, paths as Path<FormInput>[]));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-slate-900">Allergies</legend>
        {allergies.fields.map((field, i) => (
          <div key={field.id} className={`${ROW} sm:grid-cols-[1fr_1fr_12rem_auto]`}>
            <TextField
              label={`Allergy ${i + 1}: substance`}
              error={errors.allergies?.[i]?.substance?.message}
              {...register(`allergies.${i}.substance`)}
            />
            <TextField
              label="Reaction (optional)"
              error={errors.allergies?.[i]?.reaction?.message}
              {...register(`allergies.${i}.reaction`)}
            />
            <SelectField
              label="Severity"
              options={ALLERGY_SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABELS[v] }))}
              error={errors.allergies?.[i]?.severity?.message}
              {...register(`allergies.${i}.severity`)}
            />
            <RemoveButton label={`allergy ${i + 1}`} onClick={() => allergies.remove(i)} />
          </div>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => allergies.append({ substance: '', reaction: '', severity: 'unknown' })}
        >
          Add allergy
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-slate-900">Current medications</legend>
        {medications.fields.map((field, i) => (
          <div key={field.id} className={`${ROW} sm:grid-cols-[1fr_10rem_12rem_auto]`}>
            <TextField
              label={`Medication ${i + 1}: name`}
              error={errors.medications?.[i]?.name?.message}
              {...register(`medications.${i}.name`)}
            />
            <TextField
              label="Dose (optional)"
              error={errors.medications?.[i]?.dose?.message}
              {...register(`medications.${i}.dose`)}
            />
            <TextField
              label="Frequency (optional)"
              error={errors.medications?.[i]?.frequency?.message}
              {...register(`medications.${i}.frequency`)}
            />
            <RemoveButton label={`medication ${i + 1}`} onClick={() => medications.remove(i)} />
          </div>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => medications.append({ name: '', dose: '', frequency: '' })}
        >
          Add medication
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-slate-900">Long-term conditions</legend>
        {conditions.fields.map((field, i) => (
          <div key={field.id} className={`${ROW} sm:grid-cols-[1fr_11rem_1fr_auto]`}>
            <TextField
              label={`Condition ${i + 1}`}
              error={errors.conditions?.[i]?.condition?.message}
              {...register(`conditions.${i}.condition`)}
            />
            <TextField
              label="Diagnosed (optional)"
              type="date"
              error={errors.conditions?.[i]?.diagnosedDate?.message}
              {...register(`conditions.${i}.diagnosedDate`)}
            />
            <TextField
              label="Notes (optional)"
              error={errors.conditions?.[i]?.notes?.message}
              {...register(`conditions.${i}.notes`)}
            />
            <RemoveButton label={`condition ${i + 1}`} onClick={() => conditions.remove(i)} />
          </div>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => conditions.append({ condition: '', diagnosedDate: '', notes: '' })}
        >
          Add condition
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-slate-900">GP / primary care (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="GP name"
            error={errors.gpDetails?.name?.message}
            {...register('gpDetails.name')}
          />
          <TextField
            label="Practice"
            error={errors.gpDetails?.practice?.message}
            {...register('gpDetails.practice')}
          />
          <TextField
            label="Practice phone"
            type="tel"
            error={errors.gpDetails?.phone?.message}
            {...register('gpDetails.phone')}
          />
        </div>
      </fieldset>

      <TextAreaField
        label="Accessibility needs (optional)"
        error={errors.accessibilityNeeds?.message}
        {...register('accessibilityNeeds')}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isSubmitting}>
          Save medical summary
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
