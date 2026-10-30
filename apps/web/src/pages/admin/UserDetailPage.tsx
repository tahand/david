import { useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { doctorProfileSchema, staffRoleSchema, type AdminUserDto } from '@clinic/shared';
import { adminApi, adminKeys } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { applyServerErrors } from '../../lib/formErrors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  Alert,
  Button,
  Checkbox,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { formatInstant, ROLE_LABELS, STAFF_ROLE_OPTIONS } from './labels';
import { StatusBadges } from './UsersPage';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold text-heading">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="text-ink-muted sm:w-40">{label}</dt>
      <dd className="break-all text-ink">{value}</dd>
    </div>
  );
}

const profileForm = z.object({ role: staffRoleSchema, doctor: doctorProfileSchema.optional() });
type ProfileInput = z.input<typeof profileForm>;
type ProfileOutput = z.output<typeof profileForm>;

// Doctor fields only apply, and are only validated, when the role is doctor.
const validateProfile = zodResolver(profileForm);
const profileResolver: Resolver<ProfileInput, unknown, ProfileOutput> = (values, ctx, options) =>
  validateProfile(
    values.role === 'doctor' ? values : { ...values, doctor: undefined },
    ctx,
    options,
  );

/** Role and doctor profile editor for a staff account. */
function RoleAndProfile({
  user,
  onSaved,
}: {
  user: AdminUserDto;
  onSaved: (u: AdminUserDto) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput, unknown, ProfileOutput>({
    resolver: profileResolver,
    defaultValues: {
      role: user.role === 'patient' ? 'receptionist' : user.role,
      doctor: {
        displayName: user.doctor?.displayName ?? '',
        specialty: user.doctor?.specialty ?? '',
        registrationNumber: user.doctor?.registrationNumber ?? '',
        bio: user.doctor?.bio ?? '',
        isBookable: user.doctor?.isBookable ?? true,
      },
    },
  });
  const isDoctor = watch('role') === 'doctor';

  const onSubmit = handleSubmit(async ({ role, doctor }) => {
    setMessage(null);
    setFormError(null);
    try {
      const body = {
        ...(role !== user.role ? { role } : {}),
        ...(role === 'doctor' && doctor ? { doctor } : {}),
      };
      if (Object.keys(body).length === 0) return setMessage('Nothing to change.');
      const updated = await adminApi.updateUser(user.id, body);
      onSaved(updated);
      setMessage(
        role !== user.role
          ? `Saved. ${user.email} has been signed out so the new role takes effect.`
          : 'Saved.',
      );
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['role', 'doctor.displayName'] as const));
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <div aria-live="polite">
        {message && <Alert tone="success">{message}</Alert>}
        {formError && <Alert>{formError}</Alert>}
      </div>
      <SelectField
        label="Role"
        options={STAFF_ROLE_OPTIONS}
        error={errors.role?.message}
        {...register('role')}
      />
      {isDoctor && (
        <fieldset className="flex flex-col gap-4 rounded-lg border border-line p-4">
          <legend className="px-1 font-semibold text-heading">Doctor profile</legend>
          <TextField
            label="Name shown to patients"
            error={errors.doctor?.displayName?.message}
            {...register('doctor.displayName')}
          />
          <TextField label="Specialty (optional)" {...register('doctor.specialty')} />
          <TextField
            label="Registration number (optional)"
            {...register('doctor.registrationNumber')}
          />
          <TextAreaField label="Short bio (optional)" rows={3} {...register('doctor.bio')} />
          <Checkbox
            label="Patients can book online with this doctor"
            {...register('doctor.isBookable')}
          />
        </fieldset>
      )}
      <Button type="submit" loading={isSubmitting} className="self-start">
        Save changes
      </Button>
    </form>
  );
}

type Action = 'deactivate' | 'reactivate' | 'password' | 'mfa';

/** `/admin/users/:id`: account details, role, and account actions. */
export function UserDetailPage() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { created?: boolean } | null)?.created
      ? 'Account created. An invitation has been emailed.'
      : null,
  );
  const query = useQuery({ queryKey: adminKeys.user(id), queryFn: () => adminApi.user(id) });

  if (query.isPending) return <Spinner label="Loading account" />;
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          {notFound ? 'This account does not exist.' : "We couldn't load this account."}
        </Alert>
        <Link to="/admin/users" className="text-link underline">
          Back to users
        </Link>
      </div>
    );
  }

  const user = query.data;
  const isSelf = me?.user.id === user.id;
  const staff = user.role !== 'patient';
  const saved = (u: AdminUserDto) => {
    queryClient.setQueryData(adminKeys.user(id), u);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  const run = (fn: () => Promise<AdminUserDto>, done: string) => async () => {
    saved(await fn());
    setNotice(done);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/admin/users" className="text-sm text-link underline">
          ← All users
        </Link>
        <PageHeading>{user.doctor?.displayName ?? user.email}</PageHeading>
      </div>
      <div aria-live="polite">{notice && <Alert tone="success">{notice}</Alert>}</div>

      <Section title="Account">
        <dl className="flex flex-col gap-2 text-sm">
          <Detail label="Email" value={user.email} />
          <Detail label="Role" value={ROLE_LABELS[user.role]} />
          <Detail label="Status" value={<StatusBadges user={user} />} />
          <Detail label="Email confirmed" value={user.emailVerified ? 'Yes' : 'No'} />
          <Detail label="Two-step verification" value={user.mfaEnabled ? 'On' : 'Off'} />
          <Detail label="Last sign-in" value={formatInstant(user.lastLoginAt)} />
          <Detail label="Created" value={formatInstant(user.createdAt)} />
          {user.lockedUntil && (
            <Detail label="Locked until" value={formatInstant(user.lockedUntil)} />
          )}
        </dl>
      </Section>

      {staff && (
        <Section title="Role">
          {isSelf ? (
            <p className="text-ink">You can't change your own role. Ask another admin.</p>
          ) : (
            <RoleAndProfile key={user.id} user={user} onSaved={saved} />
          )}
        </Section>
      )}

      <Section title="Account actions">
        {isSelf ? (
          <p className="text-ink">
            Manage your own password and two-step verification from{' '}
            <Link to="/account/security" className="text-link underline">
              Account security
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-ink">
                Sign them out everywhere and email a link to choose a new password.
              </p>
              <Button
                variant="secondary"
                className="min-h-11 shrink-0"
                onClick={() => setAction('password')}
              >
                Reset password
              </Button>
            </li>
            {user.mfaEnabled && (
              <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-ink">
                  For a lost phone: remove their authenticator so they set it up again.
                </p>
                <Button
                  variant="secondary"
                  className="min-h-11 shrink-0"
                  onClick={() => setAction('mfa')}
                >
                  Reset two-step verification
                </Button>
              </li>
            )}
            <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-ink">
                {user.isActive
                  ? 'Stop this account from signing in. Records and history are kept.'
                  : 'Allow this account to sign in again.'}
              </p>
              {user.isActive ? (
                <Button
                  variant="danger"
                  className="min-h-11 shrink-0"
                  onClick={() => setAction('deactivate')}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="min-h-11 shrink-0"
                  onClick={() => setAction('reactivate')}
                >
                  Reactivate
                </Button>
              )}
            </li>
          </ul>
        )}
      </Section>

      {action === 'password' && (
        <ConfirmDialog
          title="Reset password?"
          confirmLabel="Reset password"
          onClose={() => setAction(null)}
          onConfirm={run(
            () => adminApi.forcePasswordReset(user.id),
            `Password reset. A link has been emailed to ${user.email}.`,
          )}
        >
          <p>
            Their current password will stop working immediately and they'll be signed out
            everywhere. We'll email {user.email} a link to choose a new one.
          </p>
        </ConfirmDialog>
      )}
      {action === 'mfa' && (
        <ConfirmDialog
          title="Reset two-step verification?"
          confirmLabel="Reset"
          onClose={() => setAction(null)}
          onConfirm={run(() => adminApi.resetMfa(user.id), 'Two-step verification reset.')}
        >
          <p>
            Only do this after confirming who you're speaking to. They'll be signed out
            {staff ? ' and must set up two-step verification again when they next sign in.' : '.'}
          </p>
        </ConfirmDialog>
      )}
      {action === 'deactivate' && (
        <ConfirmDialog
          title="Deactivate this account?"
          confirmLabel="Deactivate"
          danger
          onClose={() => setAction(null)}
          onConfirm={run(
            () => adminApi.updateUser(user.id, { isActive: false }),
            'Account deactivated.',
          )}
        >
          <p>{user.email} will be signed out and won't be able to sign in until reactivated.</p>
        </ConfirmDialog>
      )}
      {action === 'reactivate' && (
        <ConfirmDialog
          title="Reactivate this account?"
          confirmLabel="Reactivate"
          onClose={() => setAction(null)}
          onConfirm={run(
            () => adminApi.updateUser(user.id, { isActive: true }),
            'Account reactivated.',
          )}
        >
          <p>{user.email} will be able to sign in again.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
