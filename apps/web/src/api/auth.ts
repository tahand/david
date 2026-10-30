import type {
  ActiveSession,
  AuthMeResponse,
  LoginResponse,
  MfaSetupResponse,
  PublicClinicInfo,
  RecoveryCodesResponse,
} from '@clinic/shared';
import { api } from './client';

/** Auth screens handle their own 401/403 responses inline. */
const local = { globalErrors: false } as const;

export const authApi = {
  me: () => api.get<AuthMeResponse>('/auth/me', local),
  clinic: () => api.get<PublicClinicInfo>('/clinic', local),
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }, local),
  verifyMfa: (input: { code: string } | { recoveryCode: string }) =>
    api.post<AuthMeResponse>('/auth/mfa/verify', input, local),
  logout: () => api.post<void>('/auth/logout', {}, local),
  logoutAll: () => api.post<void>('/auth/logout-all'),
  register: (input: unknown) => api.post<{ message: string }>('/auth/register', input, local),
  verifyEmail: (token: string) =>
    api.post<{ message: string }>('/auth/verify-email', { token }, local),
  resendVerification: () => api.post<void>('/auth/verify-email/resend'),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }, local),
  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }, local),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }),
  mfaSetup: () => api.post<MfaSetupResponse>('/auth/mfa/setup'),
  mfaEnable: (code: string) => api.post<RecoveryCodesResponse>('/auth/mfa/enable', { code }),
  mfaDisable: (password: string, code: string) =>
    api.post<{ message: string }>('/auth/mfa/disable', { password, code }),
  regenerateRecoveryCodes: (code: string) =>
    api.post<RecoveryCodesResponse>('/auth/mfa/recovery-codes', { code }),
  sessions: () => api.get<{ sessions: ActiveSession[] }>('/auth/sessions'),
  revokeSession: (id: string) => api.delete<void>(`/auth/sessions/${encodeURIComponent(id)}`),
};
