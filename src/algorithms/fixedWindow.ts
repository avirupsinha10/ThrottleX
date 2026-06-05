import { RateLimitAlgorithm } from './base';
import { RateLimitConfig, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';
import { FIXED_WINDOW_SCRIPT } from '../redis/luaScripts';

/**
 * Fixed Window algorithm.
 *
 * Divides time into discrete windows and counts requests per window.
 * Pros: O(1) memory per key.
 * Cons: allows a 2× burst at window boundaries.
 */
export class FixedWindow implements RateLimitAlgorithm {
  async check(
    redis: RedisClient,
    config: RateLimitConfig,
    compositeKey: string,
    now: number,
  ): Promise<RateLimitResult> {
    const result = (await redis.evalScript(
      FIXED_WINDOW_SCRIPT,
      1,
      compositeKey,
      config.limit,
      config.windowMs,
      now,
    )) as [number, number, number, number];

    const [allowed, remaining, resetAt, limit] = result;
    return {
      allowed: allowed === 1,
      remaining,
      resetAt,
      limit,
      retryAfter:
        allowed === 0
          ? Math.max(0, resetAt - Math.floor(Date.now() / 1000))
          : undefined,
    };
  }
}
