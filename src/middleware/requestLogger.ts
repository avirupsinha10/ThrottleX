import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { requestDuration } from '../metrics';

declare global {
  // Extend Express Request to carry a correlation ID
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Attaches a correlation ID to every request, records structured access logs,
 * and observes request duration in Prometheus.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  req.requestId = uuidv4();
  res.setHeader('X-Request-Id', req.requestId);

  const startMs = Date.now();

  res.on('finish', () => {
    const durationSec = (Date.now() - startMs) / 1000;

    requestDuration.observe(
      { endpoint: req.path, method: req.method, status: String(res.statusCode) },
      durationSec,
    );

    logger.info('http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startMs,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  });

  next();
}
