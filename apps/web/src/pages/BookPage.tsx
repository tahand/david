import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppointmentTypeDto, DoctorProfile } from '@clinic/shared';
import { appointmentKeys, appointmentsApi } from '../api/appointments';
import { ApiError } from '../api/client';
import { doctorKeys, doctorsApi } from '../api/doctors';
import { patientKeys, patientsApi } from '../api/patients';
import { useAuth } from '../auth/AuthProvider';
import { SlotPicker, type PickedSlot } from '../components/appointments/SlotPicker';
import { Alert, Button, Spinner, TextAreaField } from '../components/forms';
import { PageHeading, useClinicInfo } from '../components/layouts';
import { formatLocalDateTime, fullName } from '../lib/format';

const ANY_DOCTOR = 'any';
const STEPS = ['Appointment type', 'Doctor', 'Date and time', 'Confirm'] as const;

/** Radio-card list used by the first two steps. */
function ChoiceList<T extends { id: string }>({
  legend,
  items,
  value,
  onChange,
  render,
}: {
  legend: string;
  items: T[];
  value: string | null;
  onChange: (id: string) => void;
  render: (item: T) => { title: string; detail?: string | null };
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const { title, detail } = render(item);
          return (
            <label
              key={item.id}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
                value === item.id ? 'border-brand bg-accent-soft' : 'border-line-strong bg-card'
              }`}
            >
              <input
                type="radio"
                name={legend}
                className="mt-1 h-4 w-4"
                checked={value === item.id}
                onChange={() => onChange(item.id)}
              />
              <span>
                <span className="block font-medium text-ink">{title}</span>
                {detail && <span className="block text-sm text-ink-muted">{detail}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Booking wizard (SPEC §10): type → doctor (or any doctor) → slot → confirm.
 * Patients book for themselves; reception and admins arrive with `?patient=`.
 */
export function BookPage() {
  const { me } = useAuth();
  const isPatient = me?.user.role === 'patient';
  const [params] = useSearchParams();
  const patientId = isPatient ? null : params.get('patient');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clinic = useClinicInfo();

  const [step, setStep] = useState(0);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [doctorChoice, setDoctorChoice] = useState<string | null>(null);
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const types = useQuery({ queryKey: appointmentKeys.types, queryFn: appointmentsApi.types });
  const doctors = useQuery({ queryKey: doctorKeys.list, queryFn: doctorsApi.list });
  const patient = useQuery({
    queryKey: patientKeys.detail(patientId ?? ''),
    queryFn: () => patientsApi.get(patientId!),
    enabled: !!patientId,
  });

  // Move focus to the step heading so screen readers announce each step.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  if (!me) return null;
  if (!isPatient && !patientId) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <PageHeading>Book an appointment</PageHeading>
        <p className="text-ink">Find the patient first, then book from their record.</p>
        <Link to="/patients" className="text-link underline">
          Find a patient
        </Link>
      </div>
    );
  }
  if (isPatient && !me.user.emailVerified) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <PageHeading>Book an appointment</PageHeading>
        <Alert tone="warning" title="Confirm your email address first">
          Use the link we emailed to {me.user.email}, then come back to book.
        </Alert>
      </div>
    );
  }
  if (types.isPending || doctors.isPending || (patientId && patient.isPending)) {
    return <Spinner label="Loading" />;
  }
  if (types.isError || doctors.isError || patient.isError) {
    return <Alert>We couldn't load booking options. Please try again.</Alert>;
  }

  const bookableDoctors = doctors.data.filter((d) => d.isBookable || !isPatient);
  const type = types.data.find((t) => t.id === typeId) ?? null;
  const chosenDoctors: DoctorProfile[] =
    doctorChoice === ANY_DOCTOR
      ? bookableDoctors
      : bookableDoctors.filter((d) => d.id === doctorChoice);
  const timezone = clinic.data?.timezone ?? 'Europe/London';
  const canContinue = [!!type, chosenDoctors.length > 0, !!slot, true][step];

  const go = (next: number) => {
    setError(null);
    setStep(next);
  };

  const book = async () => {
    if (!type || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await appointmentsApi.book({
        patientId: patientId ?? undefined,
        doctorId: slot.doctorId,
        appointmentTypeId: type.id,
        startsAt: slot.startsAt,
        reasonForVisit: reason,
      });
      await queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      navigate(isPatient ? '/appointments' : `/patients/${patientId}`, {
        state: { booked: created.id },
      });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        // Someone else got there first: refresh the times and pick again.
        setSlot(null);
        await queryClient.invalidateQueries({ queryKey: ['doctors', 'slots'] });
        setStep(2);
        setError(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <PageHeading>Book an appointment</PageHeading>
        {patient.data && (
          <p className="-mt-4 text-ink">
            For <span className="font-medium">{fullName(patient.data)}</span>
          </p>
        )}
      </div>
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 sm:p-6">
        <div>
          <p className="text-sm text-ink-muted">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-heading">
            {STEPS[step]}
          </h2>
        </div>
        {error && <Alert>{error}</Alert>}

        {step === 0 &&
          (types.data.length === 0 ? (
            <p className="text-ink">No appointment types can be booked online yet.</p>
          ) : (
            <ChoiceList<AppointmentTypeDto>
              legend="Appointment type"
              items={types.data}
              value={typeId}
              onChange={(id) => {
                setTypeId(id);
                setSlot(null);
              }}
              render={(t) => ({ title: t.name, detail: `${t.durationMinutes} minutes` })}
            />
          ))}

        {step === 1 &&
          (bookableDoctors.length === 0 ? (
            <p className="text-ink">No doctors are taking bookings at the moment.</p>
          ) : (
            <ChoiceList<{ id: string; displayName: string; specialty: string | null }>
              legend="Doctor"
              items={[
                {
                  id: ANY_DOCTOR,
                  displayName: 'Any doctor',
                  specialty: 'See the first available times',
                },
                ...bookableDoctors,
              ]}
              value={doctorChoice}
              onChange={(id) => {
                setDoctorChoice(id);
                setSlot(null);
              }}
              render={(d) => ({ title: d.displayName, detail: d.specialty })}
            />
          ))}

        {step === 2 && type && (
          <SlotPicker
            doctors={chosenDoctors}
            typeId={type.id}
            timezone={timezone}
            selected={slot}
            onSelect={setSlot}
          />
        )}

        {step === 3 && type && slot && (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-ink-muted">Appointment</dt>
                <dd className="text-ink">
                  {type.name} ({type.durationMinutes} minutes)
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-ink-muted">Doctor</dt>
                <dd className="text-ink">{slot.doctorName}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-ink-muted">When</dt>
                <dd className="text-ink">{formatLocalDateTime(`${slot.date}T${slot.time}`)}</dd>
              </div>
            </dl>
            <TextAreaField
              label="Reason for visit (optional)"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button variant="secondary" className="min-h-11" onClick={() => go(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <Button className="min-h-11" disabled={!canContinue} onClick={() => go(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button className="min-h-11" loading={submitting} onClick={book}>
              Book appointment
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
