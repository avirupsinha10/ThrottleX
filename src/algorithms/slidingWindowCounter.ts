import { RateLimitAlgorithm } from './base';
import { RateLimitConfig, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';
import { SLIDING_WINDOW_COUNTER_SCRIPT } from '../redis/luaScripts';

/**
 * Sliding Window Counter algorithm.
 *
 * Interpolates previous + current fixed windows to approximate a true sliding
 * window.  Drastically reduces boundary spikes vs pure fixed window while
 * staying O(1) in memory.
 */
export class SlidingWindowCounter implements RateLimitAlgorithm {
  async check(
    redis: RedisClient,
    config: RateLimitConfig,
    compositeKey: string,
    now: number,
  ): Promise<RateLimitResult> {
    const result = (await redis.evalScript(
      SLIDING_WINDOW_COUNTER_SCRIPT,
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
