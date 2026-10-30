import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRoutes, type DbCheck } from './modules/health/routes.js';

export interface AppDeps {
  /** Consumed from phase 3 onwards (CSRF origin check, session cookies). */
  config: Config;
  logger: Logger;
  checkDb: DbCheck;
}

/** Express app factory, kept free of side effects so tests can build isolated instances. */
export function createApp({ logger, checkDb }: AppDeps): Express {
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
      genReqId: (req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRoutes(checkDb));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
