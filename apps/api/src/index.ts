import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createPrisma } from './lib/db.js';
import { createSmtpMailer } from './lib/email.js';
import { createHibpChecker, noBreachCheck } from './lib/hibp.js';
import { PostgresRateLimiter } from './lib/rateLimiter.js';
import { createApp } from './app.js';

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });
  const prisma = createPrisma(config.databaseUrl);
  const app = createApp({
    config,
    logger,
    prisma,
    mailer: createSmtpMailer(config),
    limiter: new PostgresRateLimiter(prisma),
    isBreached: config.hibpCheckEnabled ? createHibpChecker({ logger }) : noBreachCheck,
  });

  // Loopback by default; Nginx is the public entry point (SPEC §12.3).
  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'api listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
