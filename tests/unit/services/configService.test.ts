import { ConfigService } from '../../../src/services/configService';
import { RedisClient } from '../../../src/redis/client';
import { RateLimitConfig } from '../../../src/types';

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDel = jest.fn();
const mockKeys = jest.fn();

const mockRedis = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
  keys: mockKeys,
} as unknown as RedisClient;

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService(mockRedis);
    jest.clearAllMocks();
  });

  // ─── createConfig ──────────────────────────────────────────────────────────

  describe('createConfig', () => {
    it('persists and returns the new config', async () => {
      mockSet.mockResolvedValue(undefined);

      const cfg = await service.createConfig({
        key: 'user:alice',
        algorithm: 'fixed-window',
        limit: 100,
        windowMs: 60_000,
        scope: 'user',
      });

      expect(cfg.key).toBe('user:alice');
      expect(cfg.algorithm).toBe('fixed-window');
      expect(cfg.createdAt).toBeDefined();
      expect(cfg.updatedAt).toBeDefined();
      expect(mockSet).toHaveBeenCalledWith(
        'config:user:alice',
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  // ─── getConfig ─────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns the config from the in-process cache on a hit', async () => {
      mockSet.mockResolvedValue(undefined);

      await service.createConfig({
        key: 'user:bob',
        algorithm: 'sliding-window-counter',
        limit: 50,
        windowMs: 30_000,
      });

      // Reset mock call counters — the next getConfig should not touch Redis
      mockGet.mockClear();

      const result = await service.getConfig('user:bob');

      expect(result?.key).toBe('user:bob');
      expect(mockGet).not.toHaveBeenCalled(); // served from cache
    });

    it('fetches from Redis on a cache miss', async () => {
      const stored: RateLimitConfig = {
        key: 'user:carol',
        algorithm: 'fixed-window',
        limit: 10,
        windowMs: 5_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // Exact key hit on second candidate (the key itself)
      mockGet.mockResolvedValueOnce(null); // key:endpoint miss
      mockGet.mockResolvedValueOnce(JSON.stringify(stored)); // key hit

      const result = await service.getConfig('user:carol', '/payments');

      expect(result?.key).toBe('user:carol');
      expect(mockGet).toHaveBeenCalled();
    });

    it('returns null when no config exists in Redis', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.getConfig('unknown-user');

      expect(result).toBeNull();
    });
  });

  // ─── getExactConfig ────────────────────────────────────────────────────────

  describe('getExactConfig', () => {
    it('returns null for an unknown key', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.getExactConfig('ghost');

      expect(result).toBeNull();
      expect(mockGet).toHaveBeenCalledWith('config:ghost');
    });
  });

  // ─── updateConfig ──────────────────────────────────────────────────────────

  describe('updateConfig', () => {
    it('updates an existing config', async () => {
      const original: RateLimitConfig = {
        key: 'user:dave',
        algorithm: 'fixed-window',
        limit: 10,
        windowMs: 60_000,
        createdAt: 1_000,
        updatedAt: 1_000,
      };
      mockGet.mockResolvedValue(JSON.stringify(original));
      mockSet.mockResolvedValue(undefined);

      const updated = await service.updateConfig('user:dave', { limit: 50 });

      expect(updated?.limit).toBe(50);
      expect(updated?.algorithm).toBe('fixed-window'); // unchanged
      expect(updated?.updatedAt).toBeGreaterThan(1_000);
    });

    it('returns null when config does not exist', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.updateConfig('ghost', { limit: 5 });

      expect(result).toBeNull();
    });
  });

  // ─── deleteConfig ──────────────────────────────────────────────────────────

  describe('deleteConfig', () => {
    it('returns true when the key existed', async () => {
      mockDel.mockResolvedValue(1);

      const deleted = await service.deleteConfig('user:eve');

      expect(deleted).toBe(true);
      expect(mockDel).toHaveBeenCalledWith('config:user:eve');
    });

    it('returns false when the key did not exist', async () => {
      mockDel.mockResolvedValue(0);

      const deleted = await service.deleteConfig('ghost');

      expect(deleted).toBe(false);
    });
  });

  // ─── buildDefaultConfig ────────────────────────────────────────────────────

  describe('buildDefaultConfig', () => {
    it('returns a valid fallback config with the given key', () => {
      const def = service.buildDefaultConfig('some-key');

      expect(def.key).toBe('some-key');
      expect(def.limit).toBeGreaterThan(0);
      expect(def.windowMs).toBeGreaterThan(0);
      expect(def.algorithm).toBeDefined();
    });
  });
});
