import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { MfaSetupResponse } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { HOME_BY_ROLE } from '../../auth/navigation';
import { CodeInput } from '../../components/CodeInput';
import { Alert, Button, Spinner } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { RecoveryCodes } from '../../components/RecoveryCodes';

/** Groups the base32 key for easier manual entry. */
const groupKey = (key: string) => key.match(/.{1,4}/g)?.join(' ') ?? key;

/**
 * TOTP enrolment (SPEC §5.3 `/mfa/setup`). Staff land here on first login and
 * can't reach anything else until they finish.
 */
export function MfaSetupPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const started = useRef(false);
  const forced = !!me?.user.mfaEnrolmentRequired;

  useEffect(() => {
    // One request only: each call issues a new secret.
    if (started.current || me?.user.mfaEnabled) return;
    started.current = true;
    authApi
      .mfaSetup()
      .then(setSetup, (err: unknown) =>
        setLoadError(err instanceof ApiError ? err.message : 'Could not start set-up.'),
      );
  }, [me?.user.mfaEnabled]);

  const enable = async (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authApi.mfaEnable(value);
      setCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async () => {
    await refresh();
    navigate(me ? (forced ? HOME_BY_ROLE[me.user.role] : '/account/security') : '/', {
      replace: true,
    });
  };

  if (codes) {
    return (
      <section className="max-w-xl">
        <PageHeading>Two-step verification is on</PageHeading>
        <RecoveryCodes codes={codes} onDone={finish} />
      </section>
    );
  }

  if (me?.user.mfaEnabled) {
    return (
      <section className="max-w-xl">
        <PageHeading>Two-step verification</PageHeading>
        <Alert tone="success">Two-step verification is already turned on for your account.</Alert>
      </section>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
    void enable(code);
  };

  return (
    <section className="max-w-xl">
      <PageHeading>Set up two-step verification</PageHeading>
      {forced && (
        <div className="mb-4">
          <Alert tone="info">
            Staff accounts must use two-step verification before continuing.
          </Alert>
        </div>
      )}
      {loadError && <Alert>{loadError}</Alert>}
      {!setup && !loadError && <Spinner label="Preparing set-up" />}
      {setup && (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
          <ol className="list-decimal space-y-4 pl-5 text-slate-800">
            <li>
              Install an authenticator app such as Google Authenticator, Microsoft Authenticator or
              1Password.
            </li>
            <li>
              Scan this QR code with the app:
              <img
                src={setup.qrCodeDataUrl}
                alt="QR code for your authenticator app. If you can't scan it, use the set-up key below."
                width={200}
                height={200}
                className="mt-2 rounded border border-slate-300"
              />
              <p className="mt-2 text-sm">
                Can't scan it? Enter this key instead:{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                  {groupKey(setup.manualKey)}
                </code>
              </p>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div aria-live="assertive">{error && <Alert>{error}</Alert>}</div>
          <CodeInput
            label="6-digit code"
            value={code}
            onChange={setCode}
            onComplete={(c) => void enable(c)}
            disabled={submitting}
          />
          <Button type="submit" loading={submitting} className="self-start">
            Turn on two-step verification
          </Button>
        </form>
      )}
    </section>
  );
}
