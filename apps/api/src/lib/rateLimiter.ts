import type { PrismaClient } from '@prisma/client';

export interface RateLimitResult {
  allowed: boolean;
  /** Points consumed in the current window, including this one. */
  points: number;
  retryAfterSeconds: number;
}

/** Fixed-window counter keyed by an arbitrary string (e.g. `login:ip:1.2.3.4`). */
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  /** Current count without consuming. */
  peek(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

/**
 * Postgres-backed limiter using the `rate_limits` table (SPEC §4.5), so
 * counters survive restarts. One atomic upsert per call.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const rows = await this.prisma.$queryRaw<{ points: number; expire: Date }[]>`
      INSERT INTO rate_limits (key, points, expire)
      VALUES (${key}::text, 1, now() + make_interval(secs => ${windowSeconds}::double precision))
      ON CONFLICT (key) DO UPDATE SET
        points = CASE WHEN rate_limits.expire <= now() THEN 1 ELSE rate_limits.points + 1 END,
        expire = CASE WHEN rate_limits.expire <= now()
                      THEN now() + make_interval(secs => ${windowSeconds}::double precision)
                      ELSE rate_limits.expire END,
        updated_at = now()
      RETURNING points, expire`;
    const row = rows[0]!;
    return {
      allowed: row.points <= limit,
      points: row.points,
      retryAfterSeconds: Math.max(1, Math.ceil((row.expire.getTime() - Date.now()) / 1000)),
    };
  }

  async peek(key: string): Promise<number> {
    const row = await this.prisma.rateLimit.findUnique({ where: { key } });
    return row && row.expire > new Date() ? row.points : 0;
  }

  async reset(key: string): Promise<void> {
    await this.prisma.rateLimit.deleteMany({ where: { key } });
  }
}

/** In-process limiter for unit tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { points: number; expire: number }>();

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expire <= now) {
      bucket = { points: 0, expire: now + windowSeconds * 1000 };
      this.buckets.set(key, bucket);
    }
    bucket.points += 1;
    return {
      allowed: bucket.points <= limit,
      points: bucket.points,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.expire - now) / 1000)),
    };
  }

  async peek(key: string): Promise<number> {
    const b = this.buckets.get(key);
    return b && b.expire > Date.now() ? b.points : 0;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}
