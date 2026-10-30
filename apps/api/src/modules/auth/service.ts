import type { PrismaClient, User } from '@prisma/client';
import type { Logger } from 'pino';
import {
  isStaffRole,
  type ActiveSession,
  type AuthMeResponse,
  type MfaSetupResponse,
  type RegisterInput,
} from '@clinic/shared';
import type { Config } from '../../config.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { sendInBackground, type Mailer } from '../../lib/email.js';
import * as templates from '../../lib/emailTemplates.js';
import { AppError } from '../../lib/errors.js';
import type { BreachChecker } from '../../lib/hibp.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { assertPasswordAcceptable } from '../../lib/passwordPolicy.js';
import type { RateLimiter } from '../../lib/rateLimiter.js';
import { getClinicSettings } from '../../lib/settings.js';
import { generateRecoveryCode, hmacSha256, randomToken, sha256 } from '../../lib/tokens.js';
import { newTotpSecret, qrDataUrl, totpUri, verifyTotp } from '../../lib/totp.js';
import {
  idleTimeoutMinutes,
  type AuthContext,
  type SessionMeta,
  type SessionStore,
} from './sessions.js';

export interface AuthLimits {
  /** Failed logins per account per hour before further attempts are refused (SPEC §4.5). */
  accountFailuresPerHour: number;
  /** Consecutive failures that lock the account. */
  lockoutThreshold: number;
  lockoutMinutes: number;
  /** Wrong MFA codes allowed per pending session before it is destroyed. */
  mfaAttemptsPerSession: number;
}

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  accountFailuresPerHour: 10,
  lockoutThreshold: 10,
  lockoutMinutes: 15,
  mfaAttemptsPerSession: 5,
};

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

const INVALID_CREDENTIALS = 'Email or password is incorrect';
const LOCKED_MESSAGE =
  'Too many unsuccessful sign-in attempts. Try again later or reset your password.';

export type RequestMeta = SessionMeta;

export interface AuthServiceDeps {
  prisma: PrismaClient;
  config: Config;
  logger: Logger;
  mailer: Mailer;
  cipher: FieldCipher;
  sessions: SessionStore;
  limiter: RateLimiter;
  isBreached: BreachChecker;
  limits?: Partial<AuthLimits>;
}

export class AuthService {
  private readonly prisma: PrismaClient;
  private readonly limits: AuthLimits;
  private dummyHash?: Promise<string>;

  constructor(private readonly deps: AuthServiceDeps) {
    this.prisma = deps.prisma;
    this.limits = { ...DEFAULT_AUTH_LIMITS, ...deps.limits };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private audit(entry: AuditEntry, meta: RequestMeta) {
    return writeAudit(this.prisma, { ...meta, ...entry });
  }

  private email(message: Parameters<Mailer['send']>[0]) {
    sendInBackground(this.deps.mailer, this.deps.logger, message);
  }

  private link(path: string, token?: string) {
    const url = new URL(path, this.deps.config.appUrl);
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  /** Same Argon2 parameters as real hashes so unknown-email logins take as long. */
  private getDummyHash() {
    this.dummyHash ??= hashPassword(randomToken());
    return this.dummyHash;
  }

  private mfaAad = (userId: string) => `users.mfa_secret:${userId}`;
  private recoveryHash = (code: string) => hmacSha256(this.deps.config.sessionSecret, code);

  private isUsable(user: User | null): user is User {
    return !!user && user.isActive && user.deletedAt === null;
  }

  toMe(ctx: AuthContext): AuthMeResponse {
    const { user, session } = ctx;
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
        mfaEnabled: user.mfaEnabled,
        mfaEnrolmentRequired: isStaffRole(user.role) && !user.mfaEnabled,
      },
      session: {
        idleTimeoutMinutes: idleTimeoutMinutes(user),
        expiresAt: session.expiresAt.toISOString(),
      },
    };
  }

  private async createEmailToken(
    userId: string,
    type: 'verify_email' | 'reset_password',
    ttlMs: number,
  ) {
    const token = randomToken(32);
    await this.prisma.emailToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** Atomically consumes a valid, unused token. Returns its user, or throws INVALID_TOKEN. */
  private async consumeEmailToken(token: string, type: 'verify_email' | 'reset_password') {
    const row = await this.prisma.emailToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const invalid = new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) throw invalid;
    if (!this.isUsable(row.user)) throw invalid;
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw invalid;
    return row.user;
  }

  /** Counts a failed credential check; locks the account at the threshold (SPEC §4.5). */
  private async recordFailure(user: User, meta: RequestMeta) {
    await this.deps.limiter.consume(
      `login-fail:${user.email}`,
      this.limits.accountFailuresPerHour,
      3600,
    );
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= this.limits.lockoutThreshold) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + this.limits.lockoutMinutes * 60_000),
        },
      });
      await this.audit(
        {
          actorUserId: user.id,
          action: 'auth.account.locked',
          entityType: 'user',
          entityId: user.id,
        },
        meta,
      );
      const settings = await getClinicSettings(this.prisma);
      this.email(
        templates.accountLockedMessage(
          user.email,
          this.limits.lockoutMinutes,
          this.link('/forgot-password'),
          settings.clinicName,
        ),
      );
    }
  }

  private async assertNotLocked(user: User | null, email: string) {
    const failures = await this.deps.limiter.peek(`login-fail:${email}`);
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();
    if (locked || failures >= this.limits.accountFailuresPerHour) {
      throw new AppError(423, 'ACCOUNT_LOCKED', LOCKED_MESSAGE);
    }
  }

  private async checkTotp(user: User, code: string): Promise<boolean> {
    if (!user.mfaSecretEnc) return false;
    const secret = this.deps.cipher.decrypt(user.mfaSecretEnc, this.mfaAad(user.id));
    const step = await verifyTotp(secret, code, user.mfaLastTimeStep);
    if (step === null) return false;
    // Conditional update closes the race where two requests replay one code.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ mfaLastTimeStep: null }, { mfaLastTimeStep: { lt: step } }],
      },
      data: { mfaLastTimeStep: step },
    });
    return count === 1;
  }

  private async useRecoveryCode(user: User, code: string): Promise<boolean> {
    const { count } = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: this.recoveryHash(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: this.recoveryHash(c.normalised) })),
      }),
    ]);
    return codes.map((c) => c.display);
  }

  /** Re-authentication inside a session. 400 (not 401) so the SPA doesn't treat it as a logout. */
  private async assertPassword(user: User, password: string, meta: RequestMeta) {
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.recordFailure(user, meta);
      throw new AppError(400, 'INVALID_CREDENTIALS', 'Your current password is incorrect');
    }
  }

  // ---------------------------------------------------------------------------
  // Registration & email verification
  // ---------------------------------------------------------------------------

  async register(input: RegisterInput, meta: RequestMeta): Promise<void> {
    await assertPasswordAcceptable(input.password, input.email, this.deps.isBreached);
    // Hash before the existence check so both paths cost the same.
    const passwordHash = await hashPassword(input.password);
    const settings = await getClinicSettings(this.prisma);

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Same response as a new registration; tell the real owner instead (no enumeration).
      await this.audit(
        { action: 'auth.register.duplicate', metadata: { email: input.email } },
        meta,
      );
      this.email(
        templates.alreadyRegisteredMessage(
          input.email,
          this.link('/login'),
          this.link('/forgot-password'),
          settings.clinicName,
        ),
      );
      return;
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, passwordHash, role: 'patient' },
      });
      await tx.patient.create({
        data: {
          userId: created.id,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
          phoneMobile: input.mobile,
          consentVersion: settings.consentVersion,
          consentAt: new Date(),
        },
      });
      return created;
    });

    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.register',
        entityType: 'user',
        entityId: user.id,
        metadata: { consentVersion: settings.consentVersion },
      },
      meta,
    );
    await this.sendVerification(user);
  }

  async sendVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt) return;
    const settings = await getClinicSettings(this.prisma);
    const token = await this.createEmailToken(user.id, 'verify_email', VERIFY_EMAIL_TTL_MS);
    this.email(
      templates.verifyEmailMessage(
        user.email,
        this.link('/verify-email', token),
        settings.clinicName,
      ),
    );
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const user = await this.consumeEmailToken(token, 'verify_email');
    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.email.verified',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
  }

  // ---------------------------------------------------------------------------
  // Login & MFA challenge
  // ---------------------------------------------------------------------------

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<
    { mfaRequired: true; token: string } | { mfaRequired: false; token: string; ctx: AuthContext }
  > {
    const found = await this.prisma.user.findUnique({ where: { email } });
    const user = this.isUsable(found) ? found : null;
    // Always run one Argon2 verify so timing is identical for unknown emails (SPEC §4.5).
    const passwordOk = await verifyPassword(
      user ? user.passwordHash : await this.getDummyHash(),
      password,
    );

    try {
      await this.assertNotLocked(user, email);
    } catch (err) {
      await this.audit(
        { actorUserId: user?.id, action: 'auth.login.locked', metadata: { email } },
        meta,
      );
      throw err;
    }

    if (!user || !passwordOk) {
      if (user) await this.recordFailure(user, meta);
      else
        await this.deps.limiter.consume(
          `login-fail:${email}`,
          this.limits.accountFailuresPerHour,
          3600,
        );
      await this.audit(
        { actorUserId: user?.id, action: 'auth.login.failure', metadata: { email } },
        meta,
      );
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    if (user.mfaEnabled) {
      const { token } = await this.deps.sessions.create(user.id, { ...meta, mfaPending: true });
      await this.audit(
        {
          actorUserId: user.id,
          action: 'auth.login.mfa_challenge',
          entityType: 'user',
          entityId: user.id,
        },
        meta,
      );
      return { mfaRequired: true, token };
    }

    return { mfaRequired: false, ...(await this.completeLogin(user, meta)) };
  }

  private async completeLogin(user: User, meta: RequestMeta) {
    const { token, session } = await this.deps.sessions.create(user.id, {
      ...meta,
      mfaPending: false,
    });
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0 },
    });
    await this.audit(
      { actorUserId: user.id, action: 'auth.login.success', entityType: 'user', entityId: user.id },
      meta,
    );
    return { token, ctx: { session, user: updated } };
  }

  async verifyMfa(
    pending: AuthContext,
    input: { code: string } | { recoveryCode: string },
    meta: RequestMeta,
  ) {
    const { user, session } = pending;
    const attempts = await this.deps.limiter.consume(
      `mfa-session:${session.id}`,
      this.limits.mfaAttemptsPerSession,
      300,
    );
    if (!attempts.allowed) {
      await this.deps.sessions.destroy(session.id);
      throw AppError.unauthenticated('Too many incorrect codes. Please sign in again');
    }

    const usingRecovery = 'recoveryCode' in input;
    const ok = usingRecovery
      ? await this.useRecoveryCode(user, input.recoveryCode)
      : await this.checkTotp(user, input.code);

    if (!ok) {
      await this.recordFailure(user, meta);
      await this.audit(
        { actorUserId: user.id, action: 'auth.mfa.failure', entityType: 'user', entityId: user.id },
        meta,
      );
      throw new AppError(400, 'INVALID_CREDENTIALS', 'That code is incorrect');
    }
    if (usingRecovery) {
      await this.audit(
        {
          actorUserId: user.id,
          action: 'auth.mfa.recovery_code_used',
          entityType: 'user',
          entityId: user.id,
        },
        meta,
      );
    }

    // MFA completion rotates the session ID (SPEC §4.3).
    await this.deps.sessions.destroy(session.id);
    return this.completeLogin(user, meta);
  }

  async logout(ctx: AuthContext, meta: RequestMeta): Promise<void> {
    await this.deps.sessions.destroy(ctx.session.id);
    await this.audit({ actorUserId: ctx.user.id, action: 'auth.logout' }, meta);
  }

  async logoutAll(ctx: AuthContext, meta: RequestMeta): Promise<void> {
    const count = await this.deps.sessions.destroyAllForUser(ctx.user.id);
    await this.audit(
      { actorUserId: ctx.user.id, action: 'auth.logout_all', metadata: { sessions: count } },
      meta,
    );
  }

  // ---------------------------------------------------------------------------
  // Passwords
  // ---------------------------------------------------------------------------

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!this.isUsable(user)) {
      await this.audit(
        { action: 'auth.password.reset_requested', metadata: { email, known: false } },
        meta,
      );
      return;
    }
    // Only the newest link works.
    await this.prisma.emailToken.updateMany({
      where: { userId: user.id, type: 'reset_password', usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = await this.createEmailToken(user.id, 'reset_password', RESET_PASSWORD_TTL_MS);
    const settings = await getClinicSettings(this.prisma);
    this.email(
      templates.resetPasswordMessage(
        user.email,
        this.link('/reset-password', token),
        settings.clinicName,
      ),
    );
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.password.reset_requested',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    // Validate the token's owner before policy so the email check uses the right address.
    const row = await this.prisma.emailToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (row && row.type === 'reset_password' && !row.usedAt && row.expiresAt > new Date()) {
      await assertPasswordAcceptable(password, row.user.email, this.deps.isBreached);
    }
    const user = await this.consumeEmailToken(token, 'reset_password');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
    });
    await this.deps.limiter.reset(`login-fail:${user.email}`);
    await this.deps.sessions.destroyAllForUser(user.id);
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.password.reset',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
    const settings = await getClinicSettings(this.prisma);
    this.email(
      templates.passwordChangedMessage(user.email, settings.clinicName, settings.clinicPhone),
    );
  }

  /** Returns a rotated session token; all other sessions are signed out (SPEC §4.3). */
  async changePassword(
    ctx: AuthContext,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ) {
    const { user } = ctx;
    await this.assertPassword(user, currentPassword, meta);
    await assertPasswordAcceptable(newPassword, user.email, this.deps.isBreached, 'newPassword');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.deps.sessions.destroyAllForUser(user.id, ctx.session.id);
    const rotated = await this.deps.sessions.rotate(ctx.session, meta);
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.password.changed',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
    const settings = await getClinicSettings(this.prisma);
    this.email(
      templates.passwordChangedMessage(user.email, settings.clinicName, settings.clinicPhone),
    );
    return rotated.token;
  }

  // ---------------------------------------------------------------------------
  // MFA management
  // ---------------------------------------------------------------------------

  async mfaSetup(ctx: AuthContext, meta: RequestMeta): Promise<MfaSetupResponse> {
    const { user } = ctx;
    if (user.mfaEnabled) throw AppError.conflict('Two-step verification is already enabled');
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecretEnc: this.deps.cipher.encrypt(secret, this.mfaAad(user.id)),
        mfaLastTimeStep: null,
      },
    });
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.mfa.setup_started',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
    const otpauthUri = totpUri(secret, user.email);
    return { otpauthUri, qrCodeDataUrl: await qrDataUrl(otpauthUri), manualKey: secret };
  }

  async mfaEnable(ctx: AuthContext, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (user.mfaEnabled) throw AppError.conflict('Two-step verification is already enabled');
    if (!user.mfaSecretEnc) throw new AppError(400, 'VALIDATION_ERROR', 'Start set-up first');
    if (!(await this.checkTotp(user, code))) {
      throw new AppError(400, 'INVALID_CREDENTIALS', 'That code is incorrect');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    // Privilege change: rotate the session ID.
    const rotated = await this.deps.sessions.rotate(ctx.session, meta);
    await this.audit(
      { actorUserId: user.id, action: 'auth.mfa.enabled', entityType: 'user', entityId: user.id },
      meta,
    );
    const settings = await getClinicSettings(this.prisma);
    this.email(
      templates.mfaChangedMessage(user.email, true, settings.clinicName, settings.clinicPhone),
    );
    return { recoveryCodes, token: rotated.token };
  }

  async mfaDisable(ctx: AuthContext, password: string, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (isStaffRole(user.role)) {
      throw AppError.forbidden('Two-step verification is required for staff accounts');
    }
    if (!user.mfaEnabled) throw AppError.conflict('Two-step verification is not enabled');
    await this.assertPassword(user, password, meta);
    if (!(await this.checkTotp(user, code))) {
      await this.recordFailure(user, meta);
      throw new AppError(400, 'INVALID_CREDENTIALS', 'That code is incorrect');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecretEnc: null, mfaLastTimeStep: null },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.deps.sessions.destroyAllForUser(user.id, ctx.session.id);
    const rotated = await this.deps.sessions.rotate(ctx.session, meta);
    await this.audit(
      { actorUserId: user.id, action: 'auth.mfa.disabled', entityType: 'user', entityId: user.id },
      meta,
    );
    const settings = await getClinicSettings(this.prisma);
    this.email(
      templates.mfaChangedMessage(user.email, false, settings.clinicName, settings.clinicPhone),
    );
    return rotated.token;
  }

  async regenerateRecoveryCodes(ctx: AuthContext, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!user.mfaEnabled) throw AppError.conflict('Two-step verification is not enabled');
    if (!(await this.checkTotp(user, code))) {
      throw new AppError(400, 'INVALID_CREDENTIALS', 'That code is incorrect');
    }
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    await this.audit(
      {
        actorUserId: user.id,
        action: 'auth.mfa.recovery_codes_regenerated',
        entityType: 'user',
        entityId: user.id,
      },
      meta,
    );
    return recoveryCodes;
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async listSessions(ctx: AuthContext): Promise<ActiveSession[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId: ctx.user.id, mfaPending: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === ctx.session.id,
    }));
  }

  /** Returns true when the caller revoked their own current session. */
  async revokeSession(ctx: AuthContext, sessionId: string, meta: RequestMeta): Promise<boolean> {
    const { count } = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId: ctx.user.id },
    });
    if (count === 0) throw AppError.notFound('Session not found');
    await this.audit(
      {
        actorUserId: ctx.user.id,
        action: 'auth.session.revoked',
        entityType: 'session',
        entityId: sessionId,
      },
      meta,
    );
    return sessionId === ctx.session.id;
  }
}
