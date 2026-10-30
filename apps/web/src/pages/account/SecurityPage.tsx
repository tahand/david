import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isStaffRole, passwordSchema } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { applyServerErrors } from '../../lib/formErrors';
import { CodeInput } from '../../components/CodeInput';
import { Alert, Button, PasswordField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { RecoveryCodes } from '../../components/RecoveryCodes';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 id={id} className="mb-4 text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

function ChangePassword() {
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof changeSchema>>({ resolver: zodResolver(changeSchema) });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setMessage(null);
    setFormError(null);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      setMessage(res.message);
      reset();
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', { message: err.message });
      } else {
        setFormError(applyServerErrors(err, setError, ['newPassword'] as const));
      }
    }
  });

  return (
    <Section title="Change password">
      <form noValidate onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
        <div aria-live="polite">
          {message && <Alert tone="success">{message}</Alert>}
          {formError && <Alert>{formError}</Alert>}
        </div>
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 12 characters."
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" loading={isSubmitting} className="self-start">
          Change password
        </Button>
      </form>
    </Section>
  );
}

function TwoStep() {
  const { me, refresh } = useAuth();
  const [mode, setMode] = useState<'idle' | 'regenerate' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!me) return null;
  const staff = isStaffRole(me.user.role);

  const close = () => {
    setMode('idle');
    setCode('');
    setPassword('');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'regenerate') {
        setCodes((await authApi.regenerateRecoveryCodes(code)).recoveryCodes);
      } else {
        const res = await authApi.mfaDisable(password, code);
        setNotice(res.message);
        await refresh();
      }
      close();
    } catch (err) {
      setError(errorText(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <Section title="Two-step verification">
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      </Section>
    );
  }

  return (
    <Section title="Two-step verification">
      <div aria-live="polite">{notice && <Alert tone="success">{notice}</Alert>}</div>
      {!me.user.mfaEnabled ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-slate-800">
            Two-step verification is <strong>off</strong>. Turning it on protects your account even
            if your password is stolen.
          </p>
          <Link
            to="/mfa/setup"
            className="rounded-md bg-brand-700 px-4 py-2.5 font-medium text-white hover:bg-brand-600"
          >
            Set up two-step verification
          </Link>
        </div>
      ) : mode === 'idle' ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-slate-800">
            Two-step verification is <strong>on</strong>.
            {staff && ' It is required for staff accounts.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setMode('regenerate')}>
              Get new recovery codes
            </Button>
            {!staff && (
              <Button variant="secondary" onClick={() => setMode('disable')}>
                Turn off
              </Button>
            )}
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4">
          <p className="text-slate-800">
            {mode === 'regenerate'
              ? 'Your current recovery codes will stop working. Enter a code from your authenticator app to continue.'
              : 'Confirm with your password and a code from your authenticator app.'}
          </p>
          <div aria-live="assertive">{error && <Alert>{error}</Alert>}</div>
          {mode === 'disable' && (
            <PasswordField
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <CodeInput label="6-digit code" value={code} onChange={setCode} disabled={busy} />
          <div className="flex gap-3">
            <Button
              type="submit"
              loading={busy}
              variant={mode === 'disable' ? 'danger' : 'primary'}
            >
              {mode === 'regenerate' ? 'Generate new codes' : 'Turn off two-step verification'}
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const { clearLocal } = useAuth();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: authApi.sessions });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: async (_data, id) => {
      const current = sessions.data?.sessions.find((s) => s.id === id)?.current;
      if (current) {
        clearLocal();
      } else {
        await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      }
    },
  });
  const logoutAll = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => {
      clearLocal();
    },
  });

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  return (
    <Section title="Where you're signed in">
      {sessions.isError && <Alert>{errorText(sessions.error)}</Alert>}
      {revoke.isError && <Alert>{errorText(revoke.error)}</Alert>}
      <ul className="divide-y divide-slate-200">
        {sessions.data?.sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="text-sm text-slate-800">
              <p className="font-medium text-slate-900">
                {s.userAgent ?? 'Unknown device'}
                {s.current && (
                  <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-900">
                    This device
                  </span>
                )}
              </p>
              <p>
                {s.ip ?? 'Unknown IP'} · last active {fmt(s.lastSeenAt)} · signed in{' '}
                {fmt(s.createdAt)}
              </p>
            </div>
            <Button
              variant="secondary"
              className="!px-3 !py-1.5 text-sm"
              loading={revoke.isPending && revoke.variables === s.id}
              onClick={() => revoke.mutate(s.id)}
            >
              Sign out<span className="sr-only"> session from {s.ip ?? 'unknown IP'}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="danger"
        className="mt-4"
        loading={logoutAll.isPending}
        onClick={() => logoutAll.mutate()}
      >
        Sign out of all devices
      </Button>
    </Section>
  );
}

/** `/account/security` (SPEC §5.3). */
export function SecurityPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading>Account security</PageHeading>
      <ChangePassword />
      <TwoStep />
      <Sessions />
    </div>
  );
}
