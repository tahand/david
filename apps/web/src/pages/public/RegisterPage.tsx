import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { z } from 'zod';
import { registerSchema } from '@clinic/shared';
import { authApi } from '../../api/auth';
import { applyServerErrors } from '../../lib/formErrors';
import { Alert, Button, Checkbox, PasswordField, TextField } from '../../components/forms';
import { AuthLayout } from '../../components/layouts';

const formSchema = registerSchema
  .extend({
    confirmPassword: z.string(),
    // A plain boolean in the form; the shared schema requires `true`.
    acceptTerms: z.boolean().refine((v) => v, 'You must accept the privacy notice and terms'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'email',
  'mobile',
  'password',
  'acceptTerms',
] as const;

/** Patient self-registration (SPEC §5.3). */
export function RegisterPage() {
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { acceptTerms: false },
  });

  const onSubmit = handleSubmit(async ({ confirmPassword: _confirm, ...values }) => {
    setFormError(null);
    try {
      const res = await authApi.register(values);
      setDone(res.message);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  if (done) {
    return (
      <AuthLayout title="Check your email">
        <Alert tone="success">{done}</Alert>
        <p className="mt-4 text-ink">
          We've sent a confirmation link. You can sign in now, but you'll need to confirm your email
          before booking an appointment.
        </p>
        <Link to="/login" className="mt-4 inline-block text-link underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create a patient account">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div aria-live="assertive">{formError && <Alert>{formError}</Alert>}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <TextField
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <TextField
          label="Date of birth"
          type="date"
          autoComplete="bday"
          error={errors.dateOfBirth?.message}
          {...register('dateOfBirth')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Mobile phone"
          type="tel"
          autoComplete="tel"
          error={errors.mobile?.message}
          {...register('mobile')}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 12 characters. A few unrelated words works well."
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Checkbox
          label={
            <>
              I have read and accept the{' '}
              <Link
                to="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline"
              >
                privacy notice
              </Link>{' '}
              and{' '}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline"
              >
                terms of use
              </Link>
            </>
          }
          error={errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Create account
        </Button>
        <p className="text-sm text-ink">
          Already registered?{' '}
          <Link to="/login" className="text-link underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
