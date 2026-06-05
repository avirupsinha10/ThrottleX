import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../config/logger';
import { CircuitBreaker, CircuitState } from './circuitBreaker';

/**
 * Thin wrapper around ioredis that integrates:
 *  - Automatic reconnect with exponential back-off
 *  - Circuit breaker to stop hammering a dead Redis
 *  - A single execute() method that all upstream callers use
 */
export class RedisClient {
  private readonly client: Redis;
  private readonly breaker: CircuitBreaker;
  private connected = false;

  constructor() {
    this.breaker = new CircuitBreaker({
      failureThreshold: config.circuitBreaker.failureThreshold,
      successThreshold: config.circuitBreaker.successThreshold,
      timeout: config.circuitBreaker.timeout,
    });

    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      connectTimeout: config.redis.connectTimeout,
      commandTimeout: config.redis.commandTimeout,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 200, 5000);
        logger.warn(`Redis reconnect attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.connected = true;
      logger.info('Redis connected');
    });

    this.client.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    this.client.on('close', () => {
      this.connected = false;
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting');
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  getCircuitState(): CircuitState {
    return this.breaker.getState();
  }

  isHealthy(): boolean {
    return this.connected && !this.breaker.isOpen();
  }

  /** Subscribe to circuit breaker state changes for metrics updates. */
  onCircuitStateChange(
    listener: (event: { from: CircuitState; to: CircuitState }) => void,
  ): void {
    this.breaker.on('stateChange', listener);
  }

  /** Execute any Redis operation through the circuit breaker. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.breaker.isOpen()) {
      throw new Error('Redis circuit breaker is OPEN');
    }

    try {
      const result = await operation();
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }
  }

  async evalScript(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    return this.execute(() =>
      this.client.eval(script, numKeys, ...args.map(String)),
    );
  }

  async get(key: string): Promise<string | null> {
    return this.execute(() => this.client.get(key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    await this.execute(() =>
      ttlMs
        ? this.client.set(key, value, 'PX', ttlMs)
        : this.client.set(key, value),
    );
  }

  async del(key: string): Promise<number> {
    return this.execute(() => this.client.del(key));
  }

  async ping(): Promise<string> {
    return this.execute(() => this.client.ping());
  }

  async keys(pattern: string): Promise<string[]> {
    return this.execute(() => this.client.keys(pattern));
  }
}

let instance: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!instance) {
    instance = new RedisClient();
  }
  return instance;
}
