import { useState } from 'react';
import { Link } from 'react-router';
import { authApi } from '../../api/auth';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button } from '../../components/forms';
import { PageHeading } from '../../components/layouts';

/**
 * Patient home (SPEC §10). Account alerts are live now; the next-appointment
 * card and booking arrive with phase 7.
 */
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
      <section className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-lg font-semibold text-heading">Appointments</h2>
        <p className="mt-2 text-ink">Online booking will be available here soon.</p>
      </section>
    </div>
  );
}
