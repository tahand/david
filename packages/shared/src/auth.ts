import { z } from 'zod';
import { roleSchema } from './roles.js';

/** NIST SP 800-63B lengths (SPEC §4.2); breach and email checks run server-side. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

/** Login accepts any non-empty password so policy changes never lock users out. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
/** Recovery codes are shown as xxxxx-xxxxx; accept any case, with or without the hyphen. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{5}-?[a-z2-7]{5}$/, 'Enter a valid recovery code')
  .transform((v) => v.replace('-', ''));

export const mfaVerifySchema = z.union([
  z.object({ code: totpCodeSchema }),
  z.object({ recoveryCode: recoveryCodeSchema }),
]);
export type MfaVerifyInput = z.input<typeof mfaVerifySchema>;

const isoDate = z.iso.date({ message: 'Enter a valid date' });

export const registerSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: isoDate.refine((d) => {
    const date = new Date(`${d}T00:00:00Z`);
    return date.getTime() < Date.now() && date.getUTCFullYear() >= 1900;
  }, 'Enter a valid date of birth'),
  email: emailSchema,
  mobile: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number'),
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: 'You must accept the privacy notice and terms' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const tokenSchema = z.object({ token: z.string().min(16).max(200) });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const mfaEnableSchema = z.object({ code: totpCodeSchema });
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});
export const mfaRegenerateSchema = z.object({ code: totpCodeSchema });

/** The current user as returned by the API. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  /** Staff without MFA can only reach the enrolment endpoints (SPEC §4.1). */
  mfaEnrolmentRequired: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const sessionInfoSchema = z.object({
  idleTimeoutMinutes: z.number(),
  expiresAt: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export interface AuthMeResponse {
  user: AuthUser;
  session: SessionInfo;
}
export type LoginResponse = { mfaRequired: true } | AuthMeResponse;

export interface MfaSetupResponse {
  otpauthUri: string;
  qrCodeDataUrl: string;
  /** Base32 secret for manual entry. */
  manualKey: string;
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface ActiveSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
