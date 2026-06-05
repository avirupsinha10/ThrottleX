import { CheckRequest, RateLimitResult } from '../types';
import { RedisClient } from '../redis/client';
import { ConfigService } from './configService';
import { algorithmRegistry } from '../algorithms';
import { config } from '../config';
import { logger } from '../config/logger';
import {
  requestsTotal,
  allowedRequests,
  rejectedRequests,
  redisOperationDuration,
} from '../metrics';

/**
 * Core rate-limiting service.
 *
 * Resolves configuration, routes the request to the appropriate algorithm,
 * records Prometheus metrics, and applies a safe fallback when Redis is
 * unavailable (configurable via FALLBACK_ALLOWED).
 */
export class RateLimiterService {
  constructor(
    private readonly redis: RedisClient,
    private readonly configService: ConfigService,
  ) {}

  async check(request: CheckRequest): Promise<RateLimitResult> {
    const { key, endpoint, tokens = 1 } = request;

    // Resolve configuration (explicit → fallback to built-in default)
    let cfg = await this.safeGetConfig(key, endpoint);
    if (!cfg) {
      cfg = this.configService.buildDefaultConfig(key);
    }

    const algorithm = algorithmRegistry[cfg.algorithm];
    if (!algorithm) {
      logger.error('Unknown algorithm — using fallback', { algorithm: cfg.algorithm });
      return this.fallback();
    }

    // Composite key encodes both the identifier and (optionally) the endpoint
    const compositeKey = endpoint ? `${key}:${endpoint}` : key;
    const now = Date.now();

    const endTimer = redisOperationDuration.startTimer({ operation: cfg.algorithm });

    try {
      const result = await algorithm.check(this.redis, cfg, compositeKey, now, tokens);
      endTimer();

      const scope = cfg.scope ?? 'custom';
      requestsTotal.inc({ algorithm: cfg.algorithm, allowed: String(result.allowed), scope });

      if (result.allowed) {
        allowedRequests.inc({ algorithm: cfg.algorithm, scope });
      } else {
        rejectedRequests.inc({ algorithm: cfg.algorithm, scope });
      }

      return result;
    } catch (err) {
      endTimer();
      logger.error('Rate-limit check failed', { key, endpoint, error: err });

      const fallbackAllowed = config.rateLimiter.fallbackAllowed;
      logger.warn(`Redis unavailable — falling back to ${fallbackAllowed ? 'ALLOW' : 'DENY'}`, {
        key,
      });

      return this.fallback(fallbackAllowed);
    }
  }

  private async safeGetConfig(key: string, endpoint?: string) {
    try {
      return await this.configService.getConfig(key, endpoint);
    } catch (err) {
      logger.error('Config lookup failed', { key, endpoint, error: err });
      return null;
    }
  }

  private fallback(allowed = config.rateLimiter.fallbackAllowed): RateLimitResult {
    return {
      allowed,
      remaining: allowed ? config.rateLimiter.defaultLimit : 0,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      limit: config.rateLimiter.defaultLimit,
    };
  }
}
