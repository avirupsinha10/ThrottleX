import { Router, Request, Response } from 'express';
import { RedisClient } from '../redis/client';
import { CircuitState } from '../redis/circuitBreaker';

const startTime = Date.now();

export function createHealthRouter(redis: RedisClient): Router {
  const router = Router();

  /** /health — liveness + basic readiness info for load balancers. */
  router.get('/health', async (_req: Request, res: Response): Promise<void> => {
    const circuitState = redis.getCircuitState();
    const uptime = (Date.now() - startTime) / 1000;

    let redisStatus: 'connected' | 'disconnected' | 'circuit-open';
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';

    if (circuitState === CircuitState.OPEN) {
      redisStatus = 'circuit-open';
      overallStatus = 'degraded';
    } else {
      try {
        await redis.ping();
        redisStatus = 'connected';
        overallStatus = 'healthy';
      } catch {
        redisStatus = 'disconnected';
        overallStatus = 'unhealthy';
      }
    }

    const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

    res.status(httpStatus).json({
      status: overallStatus,
      redis: redisStatus,
      circuitBreakerState: circuitState,
      uptime,
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
    });
  });

  /** /ready — Kubernetes readiness probe; 503 when Redis is unavailable. */
  router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
    if (redis.isHealthy()) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  });

  return router;
}
