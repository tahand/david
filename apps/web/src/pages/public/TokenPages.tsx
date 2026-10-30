import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { forgotPasswordSchema, passwordSchema } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { applyServerErrors } from '../../lib/formErrors';
import { Alert, Button, PasswordField, Spinner, TextField } from '../../components/forms';
import { AuthLayout } from '../../components/layouts';

/**
 * Reads `?token=` once and removes it from the address bar so it doesn't
 * linger in history or get shared with a screenshot.
 */
function useOneTimeToken(): string | null {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    if (params.has('token')) navigate(location.pathname, { replace: true });
  }, [params, location.pathname, navigate]);
  return token;
}

export function VerifyEmailPage() {
  const token = useOneTimeToken();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const sent = useRef(false);

  useEffect(() => {
    // Guard against StrictMode's double effect: tokens are single-use.
    if (!token || sent.current) return;
    sent.current = true;
    authApi.verifyEmail(token).then(
      () => setState('ok'),
      () => setState('error'),
    );
  }, [token]);

  return (
    <AuthLayout title="Confirm your email">
      {state === 'pending' && <Spinner label="Confirming your email" />}
      {state === 'ok' && (
        <>
          <Alert tone="success">Your email address is confirmed.</Alert>
          <Link to="/" className="mt-4 inline-block text-brand-700 underline">
            Continue
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <Alert>This link is invalid or has expired.</Alert>
          <p className="mt-4 text-slate-800">
            Sign in and use the reminder on your dashboard to send a new link.
          </p>
          <Link to="/login" className="mt-4 inline-block text-brand-700 underline">
            Go to sign in
          </Link>
        </>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authApi.forgotPassword(email);
      // Always the same message, whether or not the account exists (SPEC §5.3).
      setMessage("If an account exists, we've emailed you a link");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
    }
  });

  return (
    <AuthLayout title="Reset your password">
      {message ? (
        <>
          <Alert tone="success">{message}</Alert>
          <p className="mt-4 text-slate-800">The link works once and expires after 30 minutes.</p>
          <Link to="/login" className="mt-4 inline-block text-brand-700 underline">
            Back to sign in
          </Link>
        </>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
          <p className="text-slate-800">
            Enter your email and we'll send you a link to choose a new password.
          </p>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Send reset link
          </Button>
          <Link to="/login" className="text-sm text-brand-700 underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

const resetSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export function ResetPasswordPage() {
  const token = useOneTimeToken();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword(token!, password);
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['password'] as const));
    }
  });

  if (!token) {
    return (
      <AuthLayout title="Reset your password">
        <Alert>This link is invalid or has expired.</Alert>
        <Link to="/forgot-password" className="mt-4 inline-block text-brand-700 underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <>
          <Alert tone="success">
            Your password has been changed and you've been signed out everywhere.
          </Alert>
          <Link to="/login" className="mt-4 inline-block text-brand-700 underline">
            Sign in
          </Link>
        </>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          <div aria-live="assertive">
            {formError && (
              <Alert>
                {formError}{' '}
                {formError.includes('expired') && (
                  <Link to="/forgot-password" className="underline">
                    Request a new link
                  </Link>
                )}
              </Alert>
            )}
          </div>
          <PasswordField
            label="New password"
            autoComplete="new-password"
            hint="At least 12 characters."
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
