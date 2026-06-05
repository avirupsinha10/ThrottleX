import { SlidingWindowLog } from '../../../src/algorithms/slidingWindowLog';
import { RedisClient } from '../../../src/redis/client';
import { RateLimitConfig } from '../../../src/types';

const mockEvalScript = jest.fn();
const mockRedis = { evalScript: mockEvalScript } as unknown as RedisClient;

const baseConfig: RateLimitConfig = {
  key: 'test',
  algorithm: 'sliding-window-log',
  limit: 5,
  windowMs: 10_000,
};

describe('SlidingWindowLog', () => {
  let algorithm: SlidingWindowLog;

  beforeEach(() => {
    algorithm = new SlidingWindowLog();
    jest.clearAllMocks();
  });

  it('allows the first request', async () => {
    mockEvalScript.mockResolvedValue([1, 4, 1_700_000_010, 5]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
  });

  it('denies when the log is full', async () => {
    mockEvalScript.mockResolvedValue([0, 0, 1_700_000_010, 5]);

    const result = await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('passes a non-empty unique ID as the 4th ARGV', async () => {
    mockEvalScript.mockResolvedValue([1, 4, 1_700_000_010, 5]);

    await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    const callArgs = mockEvalScript.mock.calls[0] as unknown[];
    // uniqueId is the 7th argument (script, numKeys, key, limit, windowMs, now, uniqueId)
    const uniqueId = callArgs[6] as string;
    expect(typeof uniqueId).toBe('string');
    expect(uniqueId.length).toBeGreaterThan(0);
  });

  it('generates different unique IDs for concurrent calls', async () => {
    mockEvalScript.mockResolvedValue([1, 4, 1_700_000_010, 5]);

    await algorithm.check(mockRedis, baseConfig, 'test', Date.now());
    await algorithm.check(mockRedis, baseConfig, 'test', Date.now());

    const id1 = mockEvalScript.mock.calls[0]![6] as string;
    const id2 = mockEvalScript.mock.calls[1]![6] as string;
    expect(id1).not.toBe(id2);
  });
});
