import { TokenBucket } from '../../../src/algorithms/tokenBucket';
import { RedisClient } from '../../../src/redis/client';
import { RateLimitConfig } from '../../../src/types';

const mockEvalScript = jest.fn();
const mockRedis = { evalScript: mockEvalScript } as unknown as RedisClient;

const baseConfig: RateLimitConfig = {
  key: 'test',
  algorithm: 'token-bucket',
  limit: 10,
  windowMs: 1_000,
  refillRate: 10,       // 10 tokens per second
  burstCapacity: 20,    // allow bursts up to 20
};

describe('TokenBucket', () => {
  let algorithm: TokenBucket;

  beforeEach(() => {
    algorithm = new TokenBucket();
    jest.clearAllMocks();
  });

  it('allows a request when tokens are available', async () => {
    mockEvalScript.mockResolvedValue([1, 19, 1_700_000_001, 20]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
    expect(result.limit).toBe(20); // burstCapacity
  });

  it('denies when the bucket is empty', async () => {
    mockEvalScript.mockResolvedValue([0, 0, 1_700_000_002, 20]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('uses burstCapacity as the capacity argument', async () => {
    mockEvalScript.mockResolvedValue([1, 19, 1_700_000_001, 20]);
    const now = 1_700_000_000_000;

    await algorithm.check(mockRedis, baseConfig, 'test', now);

    const [, , key, capacity] = mockEvalScript.mock.calls[0] as unknown[];
    expect(key).toBe('test');
    expect(capacity).toBe(20); // burstCapacity
  });

  it('falls back to limit when burstCapacity is not set', async () => {
    const configWithoutBurst: RateLimitConfig = { ...baseConfig, burstCapacity: undefined };
    mockEvalScript.mockResolvedValue([1, 9, 1_700_000_001, 10]);

    await algorithm.check(mockRedis, configWithoutBurst, 'test', Date.now());

    const [, , , capacity] = mockEvalScript.mock.calls[0] as unknown[];
    expect(capacity).toBe(10); // falls back to limit
  });

  it('consumes the requested number of tokens', async () => {
    mockEvalScript.mockResolvedValue([1, 17, 1_700_000_001, 20]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now(), 3);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(17);

    const [, , , , , , requested] = mockEvalScript.mock.calls[0] as unknown[];
    expect(requested).toBe(3);
  });

  it('defaults to consuming 1 token when tokens is not specified', async () => {
    mockEvalScript.mockResolvedValue([1, 19, 1_700_000_001, 20]);

    await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    const [, , , , , , requested] = mockEvalScript.mock.calls[0] as unknown[];
    expect(requested).toBe(1);
  });
});
