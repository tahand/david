import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentKeys, appointmentsApi } from '../api/appointments';
import { ApiError } from '../api/client';
import { doctorKeys, doctorsApi } from '../api/doctors';
import { useAuth } from '../auth/AuthProvider';
import { SlotPicker, type PickedSlot } from '../components/appointments/SlotPicker';
import { Alert, Button, SelectField, Spinner } from '../components/forms';
import { PageHeading, useClinicInfo } from '../components/layouts';
import { formatLocalDateTime, formatLocalRange, fullName } from '../lib/format';

const ANY_DOCTOR = 'any';

/** Pick a new time (and optionally doctor) for an existing appointment. */
export function ReschedulePage() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const isPatient = me?.user.role === 'patient';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clinic = useClinicInfo();
  const [doctorChoice, setDoctorChoice] = useState<string | null>(null);
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const appointment = useQuery({
    queryKey: appointmentKeys.detail(id),
    queryFn: () => appointmentsApi.get(id),
  });
  const doctors = useQuery({ queryKey: doctorKeys.list, queryFn: doctorsApi.list });

  if (appointment.isPending || doctors.isPending) return <Spinner label="Loading" />;
  if (appointment.isError || doctors.isError) {
    const notFound = appointment.error instanceof ApiError && appointment.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{notFound ? 'Appointment not found' : 'Something went wrong'}</PageHeading>
        <Link to={isPatient ? '/appointments' : '/'} className="text-link underline">
          Back
        </Link>
      </div>
    );
  }
  const a = appointment.data;
  const backTo = isPatient ? '/appointments' : `/patients/${a.patient.id}`;
  const timezone = clinic.data?.timezone ?? 'Europe/London';
  const bookable = doctors.data.filter((d) => d.isBookable || !isPatient);
  const choice = doctorChoice ?? a.doctor.id;
  const chosen = choice === ANY_DOCTOR ? bookable : bookable.filter((d) => d.id === choice);

  if (!a.canChange) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <PageHeading>Reschedule appointment</PageHeading>
        <Alert tone="info">
          This appointment can't be changed online.
          {isPatient && clinic.data && ` Please call the clinic on ${clinic.data.clinicPhone}.`}
        </Alert>
        <Link to={backTo} className="text-link underline">
          Back
        </Link>
      </div>
    );
  }

  const submit = async () => {
    if (!slot) return;
    setSubmitting(true);
    setError(null);
    try {
      await appointmentsApi.reschedule(a.id, { doctorId: slot.doctorId, startsAt: slot.startsAt });
      await queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      navigate(backTo, { state: { rescheduled: a.id } });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        await queryClient.invalidateQueries({ queryKey: ['doctors', 'slots'] });
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link to={backTo} className="text-sm text-link underline">
        Back
      </Link>
      <div>
        <PageHeading>Reschedule appointment</PageHeading>
        <p className="-mt-4 text-ink">
          {a.appointmentType.name} with {a.doctor.displayName},{' '}
          {formatLocalRange(a.startsAtLocal, a.endsAtLocal)}
          {!isPatient && ` · ${fullName(a.patient)}`}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 sm:p-6">
        <div className="max-w-sm">
          <SelectField
            label="Doctor"
            value={choice}
            onChange={(e) => {
              setDoctorChoice(e.target.value);
              setSlot(null);
            }}
            options={[
              { value: ANY_DOCTOR, label: 'Any doctor' },
              ...bookable.map((d) => ({ value: d.id, label: d.displayName })),
            ]}
          />
        </div>
        <SlotPicker
          doctors={chosen}
          typeId={a.appointmentType.id}
          timezone={timezone}
          selected={slot}
          onSelect={setSlot}
        />
        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink" aria-live="polite">
            {slot
              ? `New time: ${formatLocalDateTime(`${slot.date}T${slot.time}`)} with ${slot.doctorName}`
              : 'Choose a new time.'}
          </p>
          <Button className="min-h-11" disabled={!slot} loading={submitting} onClick={submit}>
            Move appointment
          </Button>
        </div>
      </section>
    </div>
  );
}
