import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  exceptionCreateSchema,
  type AvailabilityExceptionDto,
  type ExceptionCreateInput,
  type ExceptionType,
} from '@clinic/shared';
import { ApiError } from '../../api/client';
import { addCalendarDays, formatLocalRange } from '../../lib/format';
import { Alert, Button, Checkbox, SelectField, TextField } from '../forms';

const TYPE_LABELS: Record<ExceptionType, string> = {
  unavailable: 'Time off',
  extra: 'Extra session',
};

interface FormValues {
  type: ExceptionType;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}
type FieldName = keyof FormValues;

/** Whole days are sent as local midnight to the midnight after the last day. */
function toPayload(v: FormValues): ExceptionCreateInput {
  return {
    type: v.type,
    startsAt: v.allDay ? `${v.startDate}T00:00` : v.startsAt,
    endsAt: v.allDay && v.endDate ? `${addCalendarDays(v.endDate, 1)}T00:00` : v.endsAt,
    reason: v.reason,
  };
}

/** Time off and one-off extra sessions (SPEC §7.1). */
export function ExceptionsPanel({
  exceptions,
  onAdd,
  onDelete,
}: {
  exceptions: AvailabilityExceptionDto[];
  onAdd: (input: ExceptionCreateInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      type: 'unavailable',
      allDay: true,
      startDate: '',
      endDate: '',
      startsAt: '',
      endsAt: '',
      reason: '',
    },
  });
  const allDay = watch('allDay');

  /** API paths (startsAt/endsAt) → whichever inputs are showing. */
  const fieldFor = (path: string | undefined): FieldName | null => {
    if (path === 'startsAt') return allDay ? 'startDate' : 'startsAt';
    if (path === 'endsAt') return allDay ? 'endDate' : 'endsAt';
    if (path === 'type' || path === 'reason') return path;
    return null;
  };
  const showIssues = (issues: { path?: string; message: string }[]) => {
    let unmatched: string | null = null;
    for (const issue of issues) {
      const field = fieldFor(issue.path);
      if (field) setError(field, { type: 'validate', message: issue.message });
      else unmatched ??= issue.message;
    }
    setFormError(unmatched);
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    setMessage(null);
    if (values.allDay && !values.endDate) values.endDate = values.startDate;
    const parsed = exceptionCreateSchema.safeParse(toPayload(values));
    if (!parsed.success) {
      showIssues(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      return;
    }
    try {
      await onAdd(parsed.data);
      reset({ ...values, startDate: '', endDate: '', startsAt: '', endsAt: '', reason: '' });
      setMessage(`${TYPE_LABELS[values.type]} added.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') showIssues(err.details);
      else
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite">{message && <Alert tone="success">{message}</Alert>}</div>
      {exceptions.length === 0 ? (
        <p className="text-ink">No upcoming time off or extra sessions.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {exceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  <span
                    className={`mr-2 rounded px-2 py-0.5 text-xs ${
                      e.type === 'unavailable'
                        ? 'bg-amber-100 text-amber-950'
                        : 'bg-accent-soft text-ink'
                    }`}
                  >
                    {TYPE_LABELS[e.type]}
                  </span>
                  {formatLocalRange(e.startsAtLocal, e.endsAtLocal)}
                </p>
                {e.reason && <p className="text-sm break-words text-ink-muted">{e.reason}</p>}
              </div>
              <Button
                variant="secondary"
                className="min-h-11 !px-3 text-sm"
                loading={deleting === e.id}
                onClick={async () => {
                  setDeleting(e.id);
                  setMessage(null);
                  try {
                    await onDelete(e.id);
                  } finally {
                    setDeleting(null);
                  }
                }}
              >
                Delete
                <span className="sr-only">
                  {' '}
                  {TYPE_LABELS[e.type].toLowerCase()}{' '}
                  {formatLocalRange(e.startsAtLocal, e.endsAtLocal)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <h3 className="font-semibold text-ink">Add time off or an extra session</h3>
        <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Type"
            options={[
              { value: 'unavailable', label: 'Time off (no bookings)' },
              { value: 'extra', label: 'Extra session (more bookings)' },
            ]}
            error={errors.type?.message}
            {...register('type')}
          />
          <div className="flex items-end pb-2">
            <Checkbox label="Whole days" {...register('allDay')} />
          </div>
          {allDay ? (
            <>
              <TextField
                label="First day"
                type="date"
                error={errors.startDate?.message}
                {...register('startDate')}
              />
              <TextField
                label="Last day (optional)"
                type="date"
                hint="Leave blank for a single day."
                error={errors.endDate?.message}
                {...register('endDate')}
              />
            </>
          ) : (
            <>
              <TextField
                label="Starts"
                type="datetime-local"
                error={errors.startsAt?.message}
                {...register('startsAt')}
              />
              <TextField
                label="Ends"
                type="datetime-local"
                error={errors.endsAt?.message}
                {...register('endsAt')}
              />
            </>
          )}
        </div>
        <TextField
          label="Note (optional)"
          hint="Only you and admins see this. Don't include medical details."
          maxLength={200}
          error={errors.reason?.message}
          {...register('reason')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto sm:self-start">
          Add
        </Button>
      </form>
    </div>
  );
}
