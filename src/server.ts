import { createApp } from './app';
import { getRedisClient } from './redis/client';
import { CircuitState } from './redis/circuitBreaker';
import { config } from './config';
import { logger } from './config/logger';
import { circuitBreakerState } from './metrics';

async function main(): Promise<void> {
  const redis = getRedisClient();

  try {
    await redis.connect();
  } catch (err) {
    logger.warn('Redis unavailable at startup — running in degraded mode', { error: err });
  }

  // Mirror circuit-breaker state changes into Prometheus
  redis.onCircuitStateChange(({ to }) => {
    const stateValue =
      to === CircuitState.CLOSED ? 0 : to === CircuitState.HALF_OPEN ? 1 : 2;
    circuitBreakerState.set(stateValue);
  });

  const app = createApp(redis);

  const server = app.listen(config.port, () => {
    logger.info('ThrottleX started', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: string) => async (): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully`);

    server.close(async () => {
      await redis.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force exit if graceful shutdown stalls
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
