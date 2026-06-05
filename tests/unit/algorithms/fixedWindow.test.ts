import { FixedWindow } from '../../../src/algorithms/fixedWindow';
import { RedisClient } from '../../../src/redis/client';
import { RateLimitConfig } from '../../../src/types';

const mockEvalScript = jest.fn();
const mockRedis = { evalScript: mockEvalScript } as unknown as RedisClient;

const baseConfig: RateLimitConfig = {
  key: 'test',
  algorithm: 'fixed-window',
  limit: 10,
  windowMs: 60_000,
};

describe('FixedWindow', () => {
  let algorithm: FixedWindow;

  beforeEach(() => {
    algorithm = new FixedWindow();
    jest.clearAllMocks();
  });

  it('allows a request when under the limit', async () => {
    mockEvalScript.mockResolvedValue([1, 9, 1_700_000_060, 10]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.limit).toBe(10);
    expect(result.retryAfter).toBeUndefined();
  });

  it('denies a request when over the limit', async () => {
    mockEvalScript.mockResolvedValue([0, 0, 1_700_000_060, 10]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('passes the correct arguments to evalScript', async () => {
    mockEvalScript.mockResolvedValue([1, 9, 1_700_000_060, 10]);
    const now = 1_700_000_000_000;

    await algorithm.check(mockRedis, baseConfig, 'my-key', now);

    expect(mockEvalScript).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'my-key',
      10,
      60_000,
      now,
    );
  });

  it('remaining is never negative', async () => {
    mockEvalScript.mockResolvedValue([1, 0, 1_700_000_060, 10]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });
});
