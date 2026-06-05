export type Algorithm =
  | 'fixed-window'
  | 'sliding-window-counter'
  | 'sliding-window-log'
  | 'token-bucket';

export type Scope = 'user' | 'api-key' | 'ip' | 'endpoint' | 'custom';

export interface RateLimitConfig {
  key: string;
  algorithm: Algorithm;
  limit: number;
  windowMs: number;
  /** Token bucket: tokens refilled per windowMs */
  refillRate?: number;
  /** Token bucket: maximum token accumulation (burst capacity) */
  burstCapacity?: number;
  scope?: Scope;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix timestamp (seconds) when the limit resets */
  resetAt: number;
  limit: number;
  /** Seconds until the next request may be allowed */
  retryAfter?: number;
}

export interface CheckRequest {
  key: string;
  endpoint?: string;
  /** Number of tokens to consume (token-bucket algorithm) */
  tokens?: number;
}

export interface ConfigCreateRequest {
  key: string;
  algorithm: Algorithm;
  limit: number;
  windowMs: number;
  refillRate?: number;
  burstCapacity?: number;
  scope?: Scope;
  description?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis: 'connected' | 'disconnected' | 'circuit-open';
  uptime: number;
  timestamp: string;
}
