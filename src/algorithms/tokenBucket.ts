import { RateLimitAlgorithm } from './base';
import { RateLimitConfig, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';
import { TOKEN_BUCKET_SCRIPT } from '../redis/luaScripts';

/**
 * Token Bucket algorithm.
 *
 * A bucket refills at a constant rate up to burstCapacity.  Requests consume
 * tokens; they are denied when the bucket is empty.  Naturally handles burst
 * traffic without penalising steady-state users.
 */
export class TokenBucket implements RateLimitAlgorithm {
  async check(
    redis: RedisClient,
    config: RateLimitConfig,
    compositeKey: string,
    now: number,
    tokens: number = 1,
  ): Promise<RateLimitResult> {
    const capacity = config.burstCapacity ?? config.limit;
    // Convert tokens-per-windowMs to tokens-per-millisecond for the Lua script
    const refillRatePerMs = (config.refillRate ?? config.limit) / config.windowMs;

    const result = (await redis.evalScript(
      TOKEN_BUCKET_SCRIPT,
      1,
      compositeKey,
      capacity,
      refillRatePerMs,
      now,
      tokens,
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
