import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { RateLimiter } from '../lib/rateLimiter.js';

export interface RateLimitRule {
  /** Namespaces the counter key, e.g. `global` or `auth`. */
  name: string;
  limit: number;
  windowSeconds: number;
  key?: (req: Request) => string;
}

/** Responds 429 RATE_LIMITED with Retry-After once the window's limit is exceeded. */
export function rateLimit(limiter: RateLimiter, rule: RateLimitRule): RequestHandler {
  return async (req, res, next) => {
    try {
      const subject = rule.key ? rule.key(req) : (req.ip ?? 'unknown');
      const result = await limiter.consume(
        `${rule.name}:${subject}`,
        rule.limit,
        rule.windowSeconds,
      );
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        return next(
          new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again'),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
