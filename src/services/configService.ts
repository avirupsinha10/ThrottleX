import { RateLimitConfig, ConfigCreateRequest } from '../types';
import { RedisClient } from '../redis/client';
import { config } from '../config';
import { logger } from '../config/logger';

const CONFIG_PREFIX = 'config:';
const CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

interface CacheEntry {
  cfg: RateLimitConfig;
  expiresAt: number;
}

/**
 * Manages rate-limit configurations stored in Redis.
 *
 * Priority lookup (most → least specific):
 *   1. key:endpoint
 *   2. key
 *   3. default:endpoint
 *   4. default
 *
 * Keeps a short-lived in-process cache (30 s) to avoid round-trips on every
 * request. Any write invalidates the relevant cache entry immediately.
 */
export class ConfigService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly redis: RedisClient) {}

  private redisKey(key: string): string {
    return `${CONFIG_PREFIX}${key}`;
  }

  private putCache(key: string, cfg: RateLimitConfig): void {
    this.cache.set(key, { cfg, expiresAt: Date.now() + this.cacheTtlMs });
  }

  private hitCache(key: string): RateLimitConfig | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.cfg;
  }

  /** Priority lookup — returns null when no explicit config exists. */
  async getConfig(key: string, endpoint?: string): Promise<RateLimitConfig | null> {
    const candidates = [
      endpoint ? `${key}:${endpoint}` : null,
      key,
      endpoint ? `default:${endpoint}` : null,
      'default',
    ].filter((k): k is string => k !== null);

    for (const candidate of candidates) {
      const cached = this.hitCache(candidate);
      if (cached) return cached;

      try {
        const raw = await this.redis.get(this.redisKey(candidate));
        if (raw) {
          const cfg = JSON.parse(raw) as RateLimitConfig;
          this.putCache(candidate, cfg);
          return cfg;
        }
      } catch (err) {
        logger.error('ConfigService.getConfig Redis error', { candidate, error: err });
      }
    }

    return null;
  }

  /** Direct key lookup (no fallback chain) — used by config CRUD routes. */
  async getExactConfig(key: string): Promise<RateLimitConfig | null> {
    const cached = this.hitCache(key);
    if (cached) return cached;

    try {
      const raw = await this.redis.get(this.redisKey(key));
      if (!raw) return null;
      const cfg = JSON.parse(raw) as RateLimitConfig;
      this.putCache(key, cfg);
      return cfg;
    } catch (err) {
      logger.error('ConfigService.getExactConfig Redis error', { key, error: err });
      return null;
    }
  }

  async createConfig(request: ConfigCreateRequest): Promise<RateLimitConfig> {
    const now = Date.now();
    const cfg: RateLimitConfig = { ...request, createdAt: now, updatedAt: now };

    await this.redis.set(this.redisKey(request.key), JSON.stringify(cfg), CONFIG_TTL_MS);
    this.putCache(request.key, cfg);

    logger.info('Config created', { key: request.key, algorithm: request.algorithm });
    return cfg;
  }

  async updateConfig(
    key: string,
    updates: Partial<Omit<ConfigCreateRequest, 'key'>>,
  ): Promise<RateLimitConfig | null> {
    const existing = await this.getExactConfig(key);
    if (!existing) return null;

    const updated: RateLimitConfig = {
      ...existing,
      ...updates,
      key: existing.key,
      updatedAt: Date.now(),
    };

    await this.redis.set(this.redisKey(key), JSON.stringify(updated), CONFIG_TTL_MS);
    this.cache.delete(key);
    this.putCache(key, updated);

    logger.info('Config updated', { key });
    return updated;
  }

  async deleteConfig(key: string): Promise<boolean> {
    const deleted = await this.redis.del(this.redisKey(key));
    this.cache.delete(key);
    logger.info('Config deleted', { key });
    return deleted > 0;
  }

  async listConfigs(): Promise<RateLimitConfig[]> {
    try {
      const redisKeys = await this.redis.keys(`${CONFIG_PREFIX}*`);
      const configs: RateLimitConfig[] = [];

      for (const rk of redisKeys) {
        const raw = await this.redis.get(rk);
        if (raw) configs.push(JSON.parse(raw) as RateLimitConfig);
      }

      return configs;
    } catch (err) {
      logger.error('ConfigService.listConfigs failed', { error: err });
      return [];
    }
  }

  /** Built-in fallback used when no explicit config exists in Redis. */
  buildDefaultConfig(key: string): RateLimitConfig {
    return {
      key,
      algorithm: config.rateLimiter.defaultAlgorithm,
      limit: config.rateLimiter.defaultLimit,
      windowMs: config.rateLimiter.defaultWindowMs,
      scope: 'custom',
    };
  }
}
