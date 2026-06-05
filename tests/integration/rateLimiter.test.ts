/**
 * Integration tests for the HTTP API.
 *
 * These tests use a mocked RedisClient so they can run in CI without a real
 * Redis instance.  They validate that the Express routes, validation, headers,
 * and status codes all behave correctly end-to-end.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { RedisClient } from '../../src/redis/client';
import { CircuitState } from '../../src/redis/circuitBreaker';

// ─── In-memory Redis stub ─────────────────────────────────────────────────────

const store = new Map<string, string>();

const mockRedis = {
  evalScript: jest.fn(),
  get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
  set: jest.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  del: jest.fn((key: string) => {
    const had = store.has(key);
    store.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }),
  ping: jest.fn().mockResolvedValue('PONG'),
  keys: jest.fn().mockResolvedValue([]),
  isHealthy: jest.fn().mockReturnValue(true),
  getCircuitState: jest.fn().mockReturnValue(CircuitState.CLOSED),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  onCircuitStateChange: jest.fn(),
} as unknown as RedisClient;

jest.mock('../../src/redis/client', () => ({
  RedisClient: jest.fn(() => mockRedis),
  getRedisClient: jest.fn(() => mockRedis),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_RESULT = [1, 99, Math.floor(Date.now() / 1000) + 60, 100];
const DENIED_RESULT  = [0, 0,  Math.floor(Date.now() / 1000) + 60, 100];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ThrottleX Integration', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    // Restore defaults
    (mockRedis.isHealthy as jest.Mock).mockReturnValue(true);
    (mockRedis.getCircuitState as jest.Mock).mockReturnValue(CircuitState.CLOSED);
    (mockRedis.ping as jest.Mock).mockResolvedValue('PONG');
    app = createApp(mockRedis);
  });

  // ─── POST /check ──────────────────────────────────────────────────────────

  describe('POST /check', () => {
    it('returns 200 with allowed:true for a valid under-limit request', async () => {
      (mockRedis.evalScript as jest.Mock).mockResolvedValue(ALLOWED_RESULT);

      const res = await request(app)
        .post('/check')
        .send({ key: 'user:alice', endpoint: '/api/v1/data' });

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
      expect(res.body.remaining).toBe(99);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('returns 429 when rate limited', async () => {
      (mockRedis.evalScript as jest.Mock).mockResolvedValue(DENIED_RESULT);

      const res = await request(app)
        .post('/check')
        .send({ key: 'user:alice', endpoint: '/api/v1/payments' });

      expect(res.status).toBe(429);
      expect(res.body.allowed).toBe(false);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('returns 400 when key is missing', async () => {
      const res = await request(app)
        .post('/check')
        .send({ endpoint: '/api/test' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('returns 400 for an invalid tokens value', async () => {
      const res = await request(app)
        .post('/check')
        .send({ key: 'user:alice', tokens: -1 });

      expect(res.status).toBe(400);
    });

    it('returns a correlation ID header on every request', async () => {
      (mockRedis.evalScript as jest.Mock).mockResolvedValue(ALLOWED_RESULT);

      const res = await request(app)
        .post('/check')
        .send({ key: 'user:alice' });

      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  // ─── GET /health ──────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with status:healthy when Redis is up', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.redis).toBe('connected');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('returns 503 when Redis ping fails', async () => {
      (mockRedis.ping as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
    });

    it('returns degraded when circuit breaker is OPEN', async () => {
      (mockRedis.getCircuitState as jest.Mock).mockReturnValue(CircuitState.OPEN);

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.redis).toBe('circuit-open');
    });
  });

  // ─── GET /ready ───────────────────────────────────────────────────────────

  describe('GET /ready', () => {
    it('returns 200 when service is healthy', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
    });

    it('returns 503 when Redis is unhealthy', async () => {
      (mockRedis.isHealthy as jest.Mock).mockReturnValue(false);

      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
    });
  });

  // ─── GET /metrics ─────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('returns Prometheus text format', async () => {
      const res = await request(app).get('/metrics');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('throttlex_');
    });
  });

  // ─── Config CRUD ─────────────────────────────────────────────────────────

  describe('POST /config', () => {
    it('creates and returns a new config', async () => {
      const res = await request(app)
        .post('/config')
        .send({
          key: 'api-key:xyz',
          algorithm: 'token-bucket',
          limit: 100,
          windowMs: 1_000,
          refillRate: 100,
          burstCapacity: 200,
          scope: 'api-key',
        });

      expect(res.status).toBe(201);
      expect(res.body.key).toBe('api-key:xyz');
      expect(res.body.algorithm).toBe('token-bucket');
      expect(res.body.createdAt).toBeDefined();
    });

    it('rejects an invalid algorithm', async () => {
      const res = await request(app)
        .post('/config')
        .send({ key: 'test', algorithm: 'magic-algo', limit: 10, windowMs: 1_000 });

      expect(res.status).toBe(400);
    });

    it('rejects a limit of 0', async () => {
      const res = await request(app)
        .post('/config')
        .send({ key: 'test', algorithm: 'fixed-window', limit: 0, windowMs: 1_000 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /config/:key', () => {
    it('returns 404 for a non-existent key', async () => {
      const res = await request(app).get('/config/ghost');
      expect(res.status).toBe(404);
    });

    it('returns the config after it has been created', async () => {
      await request(app)
        .post('/config')
        .send({ key: 'ip:10.0.0.1', algorithm: 'fixed-window', limit: 50, windowMs: 60_000 });

      const res = await request(app).get('/config/ip:10.0.0.1');
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('ip:10.0.0.1');
    });
  });

  describe('DELETE /config/:key', () => {
    it('returns 204 after deleting an existing config', async () => {
      await request(app)
        .post('/config')
        .send({ key: 'del-target', algorithm: 'fixed-window', limit: 5, windowMs: 1_000 });

      const res = await request(app).delete('/config/del-target');
      expect(res.status).toBe(204);
    });

    it('returns 404 for a non-existent config', async () => {
      (mockRedis.del as jest.Mock).mockResolvedValue(0);

      const res = await request(app).delete('/config/ghost');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /config/:key', () => {
    it('updates an existing config', async () => {
      await request(app)
        .post('/config')
        .send({ key: 'patch-me', algorithm: 'fixed-window', limit: 10, windowMs: 60_000 });

      const res = await request(app)
        .patch('/config/patch-me')
        .send({ limit: 999 });

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(999);
      expect(res.body.algorithm).toBe('fixed-window');
    });
  });

  describe('GET /configs', () => {
    it('returns an array of configs', async () => {
      (mockRedis.keys as jest.Mock).mockResolvedValue([]);

      const res = await request(app).get('/configs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.configs)).toBe(true);
    });
  });
});
