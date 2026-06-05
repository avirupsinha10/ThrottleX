import client from 'prom-client';
import { config } from '../config';

const { prefix } = config.metrics;

// Collect Node.js process metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ prefix });

export const requestsTotal = new client.Counter({
  name: `${prefix}requests_total`,
  help: 'Total number of rate-limit check requests',
  labelNames: ['algorithm', 'allowed', 'scope'],
});

export const allowedRequests = new client.Counter({
  name: `${prefix}allowed_requests_total`,
  help: 'Total number of allowed requests',
  labelNames: ['algorithm', 'scope'],
});

export const rejectedRequests = new client.Counter({
  name: `${prefix}rejected_requests_total`,
  help: 'Total number of rejected (rate-limited) requests',
  labelNames: ['algorithm', 'scope'],
});

export const redisOperationDuration = new client.Histogram({
  name: `${prefix}redis_operation_duration_seconds`,
  help: 'Duration of Redis Lua script operations in seconds',
  labelNames: ['operation'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

export const requestDuration = new client.Histogram({
  name: `${prefix}request_duration_seconds`,
  help: 'End-to-end HTTP request duration in seconds',
  labelNames: ['endpoint', 'method', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

export const activeKeys = new client.Gauge({
  name: `${prefix}active_keys`,
  help: 'Number of distinct rate-limit keys currently tracked in Redis',
});

export const circuitBreakerState = new client.Gauge({
  name: `${prefix}circuit_breaker_state`,
  help: 'Circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN',
});

export const registry = client.register;

export function getMetrics(): Promise<string> {
  return registry.metrics();
}

export function getContentType(): string {
  return registry.contentType;
}
