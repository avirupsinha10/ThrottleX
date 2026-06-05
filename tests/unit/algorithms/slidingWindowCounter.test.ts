import { SlidingWindowCounter } from '../../../src/algorithms/slidingWindowCounter';
import { RedisClient } from '../../../src/redis/client';
import { RateLimitConfig } from '../../../src/types';

const mockEvalScript = jest.fn();
const mockRedis = { evalScript: mockEvalScript } as unknown as RedisClient;

const baseConfig: RateLimitConfig = {
  key: 'test',
  algorithm: 'sliding-window-counter',
  limit: 100,
  windowMs: 60_000,
};

describe('SlidingWindowCounter', () => {
  let algorithm: SlidingWindowCounter;

  beforeEach(() => {
    algorithm = new SlidingWindowCounter();
    jest.clearAllMocks();
  });

  it('allows a request within the limit', async () => {
    mockEvalScript.mockResolvedValue([1, 99, 1_700_000_060, 100]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
    expect(result.limit).toBe(100);
  });

  it('denies a request when the limit is exceeded', async () => {
    mockEvalScript.mockResolvedValue([0, 0, 1_700_000_060, 100]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('reflects smooth interpolation between windows', async () => {
    // Halfway through the current window with 60 requests in previous —
    // effective count = 60 * 0.5 + current. If allowed, remaining reflects that.
    mockEvalScript.mockResolvedValue([1, 39, 1_700_000_060, 100]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(39);
  });

  it('passes the correct arguments to evalScript', async () => {
    mockEvalScript.mockResolvedValue([1, 99, 1_700_000_060, 100]);
    const now = 1_700_000_030_000; // 30 s into a 60 s window

    await algorithm.check(mockRedis, baseConfig, 'key:endpoint', now);

    expect(mockEvalScript).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'key:endpoint',
      100,
      60_000,
      now,
    );
  });
});
