import { Router, type RequestHandler } from 'express';
import type { RecoveryCodesResponse } from '@clinic/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requestContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { authOf, requireAuth } from '../../middleware/auth.js';
import {
  CSRF_COOKIE,
  isValidCsrfToken,
  issueCsrfToken,
  setCsrfCookie,
} from '../../middleware/csrf.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRegenerateSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdParamSchema,
  tokenSchema,
} from './schemas.js';
import type { AuthService } from './service.js';
import { clearSessionCookie, setSessionCookie, type SessionStore } from './sessions.js';

export interface AuthRouteDeps {
  service: AuthService;
  sessions: SessionStore;
  csrfSecret: Buffer;
  /** Strict per-IP limiter for credential endpoints (SPEC §4.5). */
  credentialLimit: RequestHandler;
}

const FORGOT_MESSAGE = "If an account exists, we've emailed you a link";

export function authRoutes({
  service,
  sessions,
  csrfSecret,
  credentialLimit,
}: AuthRouteDeps): Router {
  const r = Router();
  const enrolmentAllowed = requireAuth({ allowMfaEnrolment: true });

  r.get('/csrf', (req, res) => {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const token =
      typeof existing === 'string' && isValidCsrfToken(csrfSecret, existing)
        ? existing
        : issueCsrfToken(csrfSecret);
    setCsrfCookie(res, token);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: token });
  });

  r.post(
    '/register',
    credentialLimit,
    asyncHandler(async (req, res) => {
      await service.register(registerSchema.parse(req.body), requestContext(req));
      res.status(201).json({ message: 'Check your email to confirm your address, then sign in.' });
    }),
  );

  r.post(
    '/verify-email',
    credentialLimit,
    asyncHandler(async (req, res) => {
      const { token } = tokenSchema.parse(req.body);
      await service.verifyEmail(token, requestContext(req));
      res.json({ message: 'Your email address is confirmed.' });
    }),
  );

  r.post(
    '/verify-email/resend',
    credentialLimit,
    requireAuth(),
    asyncHandler(async (req, res) => {
      await service.sendVerification(authOf(req).user);
      res.status(204).end();
    }),
  );

  r.post(
    '/login',
    credentialLimit,
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      // A fresh login always gets a fresh session ID (SPEC §4.3).
      const previous = req.auth ?? req.pendingAuth;
      if (previous) await sessions.destroy(previous.session.id);

      const result = await service.login(email, password, requestContext(req));
      setSessionCookie(res, result.token);
      if (result.mfaRequired) {
        res.json({ mfaRequired: true });
      } else {
        res.json(service.toMe(result.ctx));
      }
    }),
  );

  r.post(
    '/mfa/verify',
    credentialLimit,
    asyncHandler(async (req, res) => {
      if (!req.pendingAuth)
        throw AppError.unauthenticated('Your sign-in has expired. Please sign in again');
      const input = mfaVerifySchema.parse(req.body);
      const { token, ctx } = await service.verifyMfa(req.pendingAuth, input, requestContext(req));
      setSessionCookie(res, token);
      res.json(service.toMe(ctx));
    }),
  );

  r.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const ctx = req.auth ?? req.pendingAuth;
      if (ctx) await service.logout(ctx, requestContext(req));
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  r.post(
    '/logout-all',
    enrolmentAllowed,
    asyncHandler(async (req, res) => {
      await service.logoutAll(authOf(req), requestContext(req));
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  r.post(
    '/forgot-password',
    credentialLimit,
    asyncHandler(async (req, res) => {
      const { email } = forgotPasswordSchema.parse(req.body);
      await service.forgotPassword(email, requestContext(req));
      res.json({ message: FORGOT_MESSAGE });
    }),
  );

  r.post(
    '/reset-password',
    credentialLimit,
    asyncHandler(async (req, res) => {
      const { token, password } = resetPasswordSchema.parse(req.body);
      await service.resetPassword(token, password, requestContext(req));
      clearSessionCookie(res);
      res.json({ message: 'Your password has been changed. Please sign in.' });
    }),
  );

  r.get('/me', enrolmentAllowed, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(service.toMe(authOf(req)));
  });

  r.post(
    '/change-password',
    credentialLimit,
    requireAuth(),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const token = await service.changePassword(
        authOf(req),
        currentPassword,
        newPassword,
        requestContext(req),
      );
      setSessionCookie(res, token);
      res.json({ message: 'Your password has been changed. Other devices have been signed out.' });
    }),
  );

  r.post(
    '/mfa/setup',
    enrolmentAllowed,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await service.mfaSetup(authOf(req), requestContext(req)));
    }),
  );

  r.post(
    '/mfa/enable',
    credentialLimit,
    enrolmentAllowed,
    asyncHandler(async (req, res) => {
      const { code } = mfaEnableSchema.parse(req.body);
      const { recoveryCodes, token } = await service.mfaEnable(
        authOf(req),
        code,
        requestContext(req),
      );
      setSessionCookie(res, token);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ recoveryCodes } satisfies RecoveryCodesResponse);
    }),
  );

  r.post(
    '/mfa/disable',
    credentialLimit,
    requireAuth(),
    asyncHandler(async (req, res) => {
      const { password, code } = mfaDisableSchema.parse(req.body);
      const token = await service.mfaDisable(authOf(req), password, code, requestContext(req));
      setSessionCookie(res, token);
      res.json({ message: 'Two-step verification is now off.' });
    }),
  );

  r.post(
    '/mfa/recovery-codes',
    credentialLimit,
    requireAuth(),
    asyncHandler(async (req, res) => {
      const { code } = mfaRegenerateSchema.parse(req.body);
      const recoveryCodes = await service.regenerateRecoveryCodes(
        authOf(req),
        code,
        requestContext(req),
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ recoveryCodes } satisfies RecoveryCodesResponse);
    }),
  );

  r.get(
    '/sessions',
    requireAuth(),
    asyncHandler(async (req, res) => {
      res.json({ sessions: await service.listSessions(authOf(req)) });
    }),
  );

  r.delete(
    '/sessions/:id',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const parsed = sessionIdParamSchema.safeParse(req.params);
      if (!parsed.success) throw AppError.notFound('Session not found');
      const wasCurrent = await service.revokeSession(
        authOf(req),
        parsed.data.id,
        requestContext(req),
      );
      if (wasCurrent) clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  return r;
}
