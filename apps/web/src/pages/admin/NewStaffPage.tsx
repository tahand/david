import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { staffCreateSchema, type StaffCreateInput } from '@clinic/shared';
import type { z } from 'zod';
import { adminApi } from '../../api/admin';
import { applyServerErrors } from '../../lib/formErrors';
import {
  Alert,
  Button,
  Checkbox,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { STAFF_ROLE_OPTIONS } from './labels';

type FormInput = z.input<typeof staffCreateSchema>;

/**
 * The doctor fields stay in the form state when another role is picked, so
 * drop them before validating: they only apply to doctors.
 */
const validateStaff = zodResolver(staffCreateSchema);
const resolver: Resolver<FormInput, unknown, StaffCreateInput> = (values, ctx, options) =>
  validateStaff(values.role === 'doctor' ? values : { ...values, doctor: undefined }, ctx, options);

/** `/admin/users/new`: staff accounts are only ever created here (SPEC §3). */
export function NewStaffPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, StaffCreateInput>({
    resolver,
    defaultValues: { role: 'receptionist', doctor: { isBookable: true } },
  });
  const isDoctor = watch('role') === 'doctor';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await adminApi.createStaff(values);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      navigate(`/admin/users/${created.id}`, { state: { created: true } });
    } catch (err) {
      setFormError(
        applyServerErrors(err, setError, [
          'email',
          'role',
          'doctor.displayName',
          'doctor.specialty',
          'doctor.registrationNumber',
          'doctor.bio',
        ] as const),
      );
    }
  });

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeading>Add staff member</PageHeading>
      <p className="text-ink">
        We'll email them a link to choose a password. They'll need to set up two-step verification
        when they first sign in.
      </p>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
        <TextField
          label="Work email"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...register('email')}
        />
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
              hint="For example, Dr Alex Example"
              error={errors.doctor?.displayName?.message}
              {...register('doctor.displayName')}
            />
            <TextField
              label="Specialty (optional)"
              error={errors.doctor?.specialty?.message}
              {...register('doctor.specialty')}
            />
            <TextField
              label="Registration number (optional)"
              error={errors.doctor?.registrationNumber?.message}
              {...register('doctor.registrationNumber')}
            />
            <TextAreaField
              label="Short bio (optional)"
              rows={3}
              error={errors.doctor?.bio?.message}
              {...register('doctor.bio')}
            />
            <Checkbox
              label="Patients can book online with this doctor"
              {...register('doctor.isBookable')}
            />
          </fieldset>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Link
            to="/admin/users"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-card px-4 py-2.5 font-medium text-ink"
          >
            Cancel
          </Link>
          <Button type="submit" loading={isSubmitting}>
            Create account and send invitation
          </Button>
        </div>
      </form>
    </div>
  );
}
