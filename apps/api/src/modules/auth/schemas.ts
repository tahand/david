import { z } from 'zod';

export {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRegenerateSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@clinic/shared';

export const sessionIdParamSchema = z.object({ id: z.uuid() });
