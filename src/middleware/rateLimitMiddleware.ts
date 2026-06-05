import { Request, Response, NextFunction } from 'express';
import { RateLimiterService } from '../services/rateLimiterService';
import { logger } from '../config/logger';

/** Writes the standard rate-limit response headers onto a Response object. */
export function applyRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number,
  retryAfter?: number,
): void {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', resetAt);
  if (retryAfter !== undefined) {
    res.setHeader('Retry-After', retryAfter);
  }
}

/**
 * Factory that returns an Express middleware enforcing per-IP rate limits on
 * every incoming request.  Intended as a blanket protection layer; the
 * /check endpoint enables per-key fine-grained control.
 */
export function createRateLimitMiddleware(rateLimiter: RateLimiterService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    try {
      const result = await rateLimiter.check({ key: ip, endpoint: req.path });

      applyRateLimitHeaders(res, result.limit, result.remaining, result.resetAt, result.retryAfter);

      if (!result.allowed) {
        res.status(429).json({
          error: 'Too Many Requests',
          retryAfter: result.retryAfter,
          resetAt: result.resetAt,
        });
        return;
      }

      next();
    } catch (err) {
      logger.error('Rate-limit middleware error', { error: err });
      // Fail open: do not block the request due to an internal error
      next();
    }
  };
}
