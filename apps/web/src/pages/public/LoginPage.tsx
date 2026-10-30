import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginSchema } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { destinationFor, safeNext } from '../../auth/navigation';
import { Alert, Button, PasswordField, TextField } from '../../components/forms';
import { AuthLayout } from '../../components/layouts';

type FormValues = { email: string; password: string };

const REASONS: Record<string, string> = {
  timeout: 'You were signed out because of inactivity.',
  expired: 'Your session has ended. Please sign in again.',
};

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const reason = params.get('reason');
  const { setMe } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      const result = await authApi.login(email, password);
      if ('mfaRequired' in result) {
        const q = safeNext(next);
        navigate(q ? `/login/mfa?next=${encodeURIComponent(q)}` : '/login/mfa');
        return;
      }
      setMe(result);
      navigate(destinationFor(result, next), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && ['ACCOUNT_LOCKED', 'RATE_LIMITED'].includes(err.code)) {
        setFormError(err.message);
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError('Email or password is incorrect');
      } else {
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      }
    }
  });

  return (
    <AuthLayout title="Sign in">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {reason && REASONS[reason] && !formError && <Alert tone="info">{REASONS[reason]}</Alert>}
        <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message ? 'Enter your password' : undefined}
          {...register('password')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Sign in
        </Button>
        <div className="flex flex-col gap-2 text-sm">
          <Link to="/forgot-password" className="text-brand-700 underline">
            Forgot password?
          </Link>
          <p className="text-slate-800">
            New patient?{' '}
            <Link to="/register" className="text-brand-700 underline">
              Create an account
            </Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}
