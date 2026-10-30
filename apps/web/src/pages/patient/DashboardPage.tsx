import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { authApi } from '../../api/auth';
import { useAuth } from '../../auth/AuthProvider';
import { isUpcoming } from '../../components/appointments/AppointmentList';
import { StatusBadge } from '../../components/appointments/StatusBadge';
import { Alert, Button, Spinner } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { formatLocalRange } from '../../lib/format';

const linkButton =
  'inline-flex min-h-11 items-center rounded-md px-4 font-medium bg-brand text-on-brand hover:bg-brand-hover';

/** Next appointment, with links to book and to the full list. */
function NextAppointment({ canBook }: { canBook: boolean }) {
  const query = useQuery({
    queryKey: appointmentKeys.list({}),
    queryFn: () => appointmentsApi.list(),
  });
  const next = query.data?.appointments.find((a) => isUpcoming(a));
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-heading">Next appointment</h2>
      {query.isPending ? (
        <Spinner label="Loading appointments" />
      ) : query.isError ? (
        <p className="text-ink">We couldn't load your appointments.</p>
      ) : next ? (
        <div>
          <p className="font-semibold text-ink">
            {formatLocalRange(next.startsAtLocal, next.endsAtLocal)}
          </p>
          <p className="text-ink">
            {next.appointmentType.name} with {next.doctor.displayName}{' '}
            <StatusBadge status={next.status} />
          </p>
        </div>
      ) : (
        <p className="text-ink">You have no upcoming appointments.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {canBook && (
          <Link to="/book" className={linkButton}>
            Book appointment
          </Link>
        )}
        <Link to="/appointments" className="text-link underline">
          All appointments
        </Link>
      </div>
    </section>
  );
}

/** Patient home (SPEC §10): account alerts and the next appointment. */
export function DashboardPage() {
  const { me } = useAuth();
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  if (!me) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading>Welcome</PageHeading>
      {!me.user.emailVerified && (
        <Alert tone="warning" title="Confirm your email address">
          <p>We sent a link to {me.user.email}. You'll need to confirm it before booking.</p>
          {resent ? (
            <p className="mt-2 font-medium">A new link is on its way.</p>
          ) : (
            <Button
              variant="link"
              className="mt-2"
              loading={resending}
              onClick={async () => {
                setResending(true);
                try {
                  await authApi.resendVerification();
                  setResent(true);
                } finally {
                  setResending(false);
                }
              }}
            >
              Send a new link
            </Button>
          )}
        </Alert>
      )}
      {!me.user.mfaEnabled && (
        <Alert tone="info" title="Protect your account">
          <p>
            Turn on two-step verification so only you can sign in, even if your password is stolen.
          </p>
          <Link to="/mfa/setup" className="mt-2 inline-block font-medium text-link underline">
            Set up two-step verification
          </Link>
        </Alert>
      )}
      <NextAppointment canBook={me.user.emailVerified} />
    </div>
  );
}
