import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { AppointmentList, isUpcoming } from '../../components/appointments/AppointmentList';
import { Alert, Spinner } from '../../components/forms';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { Section } from '../../components/patient/DetailList';

/** The patient's upcoming and past appointments (SPEC §10). */
export function AppointmentsPage() {
  const location = useLocation();
  const clinic = useClinicInfo();
  const queryClient = useQueryClient();
  const state = location.state as { booked?: string; rescheduled?: string } | null;
  const [message, setMessage] = useState<string | null>(
    state?.booked
      ? 'Your appointment is booked.'
      : state?.rescheduled
        ? 'Your appointment has been moved.'
        : null,
  );
  const query = useQuery({
    queryKey: appointmentKeys.list({}),
    queryFn: () => appointmentsApi.list(),
  });

  if (query.isPending) return <Spinner label="Loading appointments" />;
  if (query.isError) return <Alert>We couldn't load your appointments. Please try again.</Alert>;

  const { appointments, changeCutoffHours } = query.data;
  const now = Date.now();
  const upcoming = appointments.filter((a) => isUpcoming(a, now));
  const past = appointments.filter((a) => !isUpcoming(a, now)).reverse();
  const phone = clinic.data?.clinicPhone;
  const callHint = `Changes within ${changeCutoffHours} hours of the start need a phone call${
    phone ? ` to ${phone}` : ''
  }.`;
  const changed = () => {
    setMessage('Your appointment has been cancelled.');
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="-mb-6 flex flex-wrap items-start justify-between gap-x-3">
        <PageHeading>Appointments</PageHeading>
        <Link
          to="/book"
          className="mb-6 inline-flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover"
        >
          Book appointment
        </Link>
      </div>
      <div aria-live="polite">{message && <Alert tone="success">{message}</Alert>}</div>
      <Section title="Upcoming">
        <p className="mb-3 text-sm text-ink-muted">
          You can reschedule or cancel online up to {changeCutoffHours} hours before an appointment.
        </p>
        <AppointmentList
          appointments={upcoming}
          empty="You have no upcoming appointments."
          onChanged={changed}
          changeClosedHint={callHint}
        />
      </Section>
      <Section title="Past and cancelled">
        <AppointmentList appointments={past} empty="Nothing here yet." onChanged={changed} />
      </Section>
    </div>
  );
}
