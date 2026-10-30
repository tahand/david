import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_CREDENTIALS',
  'INVALID_TOKEN',
  'MFA_ENROLMENT_REQUIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'SLOT_UNAVAILABLE',
  'CHANGE_WINDOW_CLOSED',
  'EMAIL_NOT_VERIFIED',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'CSRF_INVALID',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Consistent API error body (SPEC §9). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
