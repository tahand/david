import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { FieldCipher } from './lib/crypto.js';
import type { Mailer } from './lib/email.js';
import type { BreachChecker } from './lib/hibp.js';
import type { RateLimiter } from './lib/rateLimiter.js';
import { auditContext } from './middleware/audit.js';
import { loadSession } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService, type AuthLimits } from './modules/auth/service.js';
import { SessionStore } from './modules/auth/sessions.js';
import { clinicRoutes } from './modules/clinic/routes.js';
import { doctorRoutes } from './modules/doctors/routes.js';
import { DoctorService } from './modules/doctors/service.js';
import { healthRoutes, type DbCheck } from './modules/health/routes.js';
import { patientRoutes } from './modules/patients/routes.js';
import { PatientService } from './modules/patients/service.js';

export interface RateLimitSettings {
  /** SPEC §11: 100 requests/min per IP. */
  globalPerMinute: number;
  /** SPEC §4.5: 5 attempts/min per IP on credential endpoints. */
  credentialPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  globalPerMinute: 100,
  credentialPerMinute: 5,
};

export interface AppDeps {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  mailer: Mailer;
  limiter: RateLimiter;
  isBreached: BreachChecker;
  checkDb?: DbCheck;
  rateLimits?: Partial<RateLimitSettings>;
  authLimits?: Partial<AuthLimits>;
}

/** Express app factory, kept free of side effects so tests can build isolated instances. */
export function createApp(deps: AppDeps): Express {
  const { config, logger, prisma, limiter } = deps;
  const limits = { ...DEFAULT_RATE_LIMITS, ...deps.rateLimits };
  const checkDb: DbCheck =
    deps.checkDb ??
    (async () => {
      await prisma.$queryRaw`SELECT 1`;
    });

  const sessions = new SessionStore(prisma);
  const cipher = FieldCipher.single(config.dataEncryptionKeyVersion, config.dataEncryptionKey);
  const authService = new AuthService({
    prisma,
    config,
    logger,
    mailer: deps.mailer,
    cipher,
    sessions,
    limiter,
    isBreached: deps.isBreached,
    limits: deps.authLimits,
  });
  const patientService = new PatientService({ prisma, cipher });
  const doctorService = new DoctorService({ prisma, timezone: config.clinicTimezone });

  const app = express();

  // Behind Nginx (SPEC §12.3).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use('/api/health', healthRoutes(checkDb));

  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit(limiter, { name: 'global', limit: limits.globalPerMinute, windowSeconds: 60 }),
  );
  app.use('/api', loadSession(sessions));
  app.use('/api', auditContext(prisma));
  app.use('/api', csrfProtection({ secret: config.sessionSecret, appOrigin: config.appOrigin }));

  app.use(
    '/api/auth',
    authRoutes({
      service: authService,
      sessions,
      csrfSecret: config.sessionSecret,
      credentialLimit: rateLimit(limiter, {
        name: 'credential',
        limit: limits.credentialPerMinute,
        windowSeconds: 60,
      }),
    }),
  );

  app.use('/api/clinic', clinicRoutes(prisma, config.clinicTimezone));
  app.use('/api/patients', patientRoutes({ service: patientService }));
  app.use('/api/doctors', doctorRoutes({ service: doctorService }));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
