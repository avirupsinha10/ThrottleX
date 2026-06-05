import { v4 as uuidv4 } from 'uuid';
import { RateLimitAlgorithm } from './base';
import { RateLimitConfig, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';
import { SLIDING_WINDOW_LOG_SCRIPT } from '../redis/luaScripts';

/**
 * Sliding Window Log algorithm.
 *
 * Stores each request timestamp in a Redis sorted set.  Evicts entries older
 * than the window on every check.  Most accurate; O(log N) per request where
 * N is the number of requests in the window.
 */
export class SlidingWindowLog implements RateLimitAlgorithm {
  async check(
    redis: RedisClient,
    config: RateLimitConfig,
    compositeKey: string,
    now: number,
  ): Promise<RateLimitResult> {
    // Unique member ID prevents ZADD collisions at the same millisecond
    const uniqueId = uuidv4().replace(/-/g, '');

    const result = (await redis.evalScript(
      SLIDING_WINDOW_LOG_SCRIPT,
      1,
      compositeKey,
      config.limit,
      config.windowMs,
      now,
      uniqueId,
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
