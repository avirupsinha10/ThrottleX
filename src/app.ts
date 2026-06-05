import express, { Application, Request, Response, NextFunction } from 'express';
import { RedisClient } from './redis/client';
import { ConfigService } from './services/configService';
import { RateLimiterService } from './services/rateLimiterService';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { createCheckRouter } from './routes/check';
import { createConfigRouter } from './routes/config';
import { createHealthRouter } from './routes/health';
import { createMetricsRouter } from './routes/metrics';
import { logger } from './config/logger';

export function createApp(redis: RedisClient): Application {
  const app = express();

  // Parse JSON bodies (limit to 1 MB to guard against large payloads)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Structured request logging + Prometheus timing
  app.use(requestLoggerMiddleware);

  // Trust first proxy header — required for accurate IP extraction
  app.set('trust proxy', 1);

  const configService = new ConfigService(redis);
  const rateLimiter = new RateLimiterService(redis, configService);

  // Routes
  app.use('/', createHealthRouter(redis));
  app.use('/', createMetricsRouter());
  app.use('/', createCheckRouter(rateLimiter));
  app.use('/', createConfigRouter(configService));

  // 404 catch-all
  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Global error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error('Unhandled application error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
