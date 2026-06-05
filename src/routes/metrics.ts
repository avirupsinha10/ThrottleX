import { Router, Request, Response } from 'express';
import { getMetrics, getContentType } from '../metrics';

export function createMetricsRouter(): Router {
  const router = Router();

  /** /metrics — Prometheus scrape endpoint. */
  router.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
    try {
      const output = await getMetrics();
      res.setHeader('Content-Type', getContentType());
      res.send(output);
    } catch (err) {
      res.status(500).json({ error: 'Failed to collect metrics' });
    }
  });

  return router;
}
