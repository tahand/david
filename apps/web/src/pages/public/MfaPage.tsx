import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { recoveryCodeSchema } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { CodeInput } from '../../components/CodeInput';
import { Alert, Button, TextField } from '../../components/forms';
import { AuthLayout } from '../../components/layouts';
import { destinationFor } from '../../auth/navigation';

/** Second step of sign-in (SPEC §5.2). */
export function MfaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setMe } = useAuth();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const submit = async (input: { code: string } | { recoveryCode: string }) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const me = await authApi.verifyMfa(input);
      setMe(me);
      navigate(destinationFor(me, params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setExpired(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setCode('');
        codeRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const backToSignIn = async () => {
    await authApi.logout().catch(() => {});
    navigate('/login', { replace: true });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'totp') {
      if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
      void submit({ code });
    } else {
      const parsed = recoveryCodeSchema.safeParse(recovery);
      if (!parsed.success) return setError('Enter a valid recovery code, like abcde-fghij');
      void submit({ recoveryCode: recovery });
    }
  };

  if (expired) {
    return (
      <AuthLayout title="Sign-in expired">
        <Alert>Your sign-in has expired or too many incorrect codes were entered.</Alert>
        <Button className="mt-4 w-full" onClick={backToSignIn}>
          Back to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Two-step verification">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div aria-live="assertive">{error && <Alert>{error}</Alert>}</div>
        {mode === 'totp' ? (
          <>
            <p className="text-ink">Enter the 6-digit code from your authenticator app.</p>
            <CodeInput
              ref={codeRef}
              label="Authentication code"
              value={code}
              onChange={setCode}
              onComplete={(c) => void submit({ code: c })}
              disabled={submitting}
            />
          </>
        ) : (
          <>
            <p className="text-ink">
              Enter one of the recovery codes you saved when you set up two-step verification. Each
              code works once.
            </p>
            <TextField
              label="Recovery code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
            />
          </>
        )}
        <Button type="submit" loading={submitting} className="w-full">
          Verify
        </Button>
        <div className="flex flex-col items-start gap-2 text-sm">
          <Button
            variant="link"
            onClick={() => {
              setError(null);
              setMode(mode === 'totp' ? 'recovery' : 'totp');
            }}
          >
            {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app instead'}
          </Button>
          <Button variant="link" onClick={backToSignIn}>
            Back to sign in
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
