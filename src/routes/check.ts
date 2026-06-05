import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { RateLimiterService } from '../services/rateLimiterService';
import { applyRateLimitHeaders } from '../middleware/rateLimitMiddleware';
import { logger } from '../config/logger';

export function createCheckRouter(rateLimiter: RateLimiterService): Router {
  const router = Router();

  router.post(
    '/check',
    [
      body('key').notEmpty().withMessage('key is required'),
      body('endpoint').optional().isString(),
      body('tokens').optional().isInt({ min: 1 }).withMessage('tokens must be a positive integer'),
    ],
    async (req: Request, res: Response): Promise<void> => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { key, endpoint, tokens } = req.body as {
        key: string;
        endpoint?: string;
        tokens?: number;
      };

      try {
        const result = await rateLimiter.check({ key, endpoint, tokens });

        applyRateLimitHeaders(
          res,
          result.limit,
          result.remaining,
          result.resetAt,
          result.retryAfter,
        );

        logger.info('rate_limit_decision', {
          requestId: req.requestId,
          key,
          endpoint,
          allowed: result.allowed,
          remaining: result.remaining,
          resetAt: result.resetAt,
        });

        const status = result.allowed ? 200 : 429;
        res.status(status).json({
          allowed: result.allowed,
          remaining: result.remaining,
          resetAt: result.resetAt,
          limit: result.limit,
          ...(result.retryAfter !== undefined && { retryAfter: result.retryAfter }),
        });
      } catch (err) {
        logger.error('POST /check error', { requestId: req.requestId, key, error: err });
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  return router;
}
