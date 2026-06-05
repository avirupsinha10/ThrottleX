import { RateLimitConfig, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';

/** Common contract for all rate-limiting algorithms. */
export interface RateLimitAlgorithm {
  check(
    redis: RedisClient,
    config: RateLimitConfig,
    compositeKey: string,
    now: number,
    tokens?: number,
  ): Promise<RateLimitResult>;
}
