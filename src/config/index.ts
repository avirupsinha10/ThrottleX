import dotenv from 'dotenv';
import type { Algorithm } from '../types';

dotenv.config();

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  redis: {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
    db: parseInt(process.env['REDIS_DB'] ?? '0', 10),
    connectTimeout: parseInt(process.env['REDIS_CONNECT_TIMEOUT'] ?? '5000', 10),
    commandTimeout: parseInt(process.env['REDIS_COMMAND_TIMEOUT'] ?? '2000', 10),
  },

  circuitBreaker: {
    failureThreshold: parseInt(process.env['CB_FAILURE_THRESHOLD'] ?? '5', 10),
    successThreshold: parseInt(process.env['CB_SUCCESS_THRESHOLD'] ?? '2', 10),
    timeout: parseInt(process.env['CB_TIMEOUT'] ?? '30000', 10),
  },

  rateLimiter: {
    defaultAlgorithm: (process.env['DEFAULT_ALGORITHM'] ?? 'sliding-window-counter') as Algorithm,
    defaultLimit: parseInt(process.env['DEFAULT_LIMIT'] ?? '100', 10),
    defaultWindowMs: parseInt(process.env['DEFAULT_WINDOW_MS'] ?? '60000', 10),
    fallbackAllowed: process.env['FALLBACK_ALLOWED'] !== 'false',
  },

  metrics: {
    prefix: process.env['METRICS_PREFIX'] ?? 'throttlex_',
  },
} as const;
