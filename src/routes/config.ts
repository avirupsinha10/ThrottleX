import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { ConfigService } from '../services/configService';
import { Algorithm } from '../types';

const VALID_ALGORITHMS: Algorithm[] = [
  'fixed-window',
  'sliding-window-counter',
  'sliding-window-log',
  'token-bucket',
];

export function createConfigRouter(configService: ConfigService): Router {
  const router = Router();

  // POST /config — Create or replace a rate-limit config
  router.post(
    '/config',
    [
      body('key').notEmpty().withMessage('key is required'),
      body('algorithm')
        .isIn(VALID_ALGORITHMS)
        .withMessage(`algorithm must be one of: ${VALID_ALGORITHMS.join(', ')}`),
      body('limit').isInt({ min: 1 }).withMessage('limit must be a positive integer'),
      body('windowMs').isInt({ min: 100 }).withMessage('windowMs must be >= 100'),
      body('refillRate').optional().isFloat({ min: 0.001 }),
      body('burstCapacity').optional().isInt({ min: 1 }),
      body('scope')
        .optional()
        .isIn(['user', 'api-key', 'ip', 'endpoint', 'custom']),
      body('description').optional().isString().isLength({ max: 255 }),
    ],
    async (req: Request, res: Response): Promise<void> => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const cfg = await configService.createConfig(req.body);
      res.status(201).json(cfg);
    },
  );

  // GET /config/:key — Retrieve an explicit config
  router.get(
    '/config/:key',
    [param('key').notEmpty()],
    async (req: Request, res: Response): Promise<void> => {
      const { key } = req.params;
      const cfg = await configService.getExactConfig(key);

      if (!cfg) {
        res.status(404).json({ error: 'Config not found', key });
        return;
      }

      res.json(cfg);
    },
  );

  // PATCH /config/:key — Partial update
  router.patch(
    '/config/:key',
    [
      param('key').notEmpty(),
      body('algorithm').optional().isIn(VALID_ALGORITHMS),
      body('limit').optional().isInt({ min: 1 }),
      body('windowMs').optional().isInt({ min: 100 }),
      body('refillRate').optional().isFloat({ min: 0.001 }),
      body('burstCapacity').optional().isInt({ min: 1 }),
      body('scope').optional().isIn(['user', 'api-key', 'ip', 'endpoint', 'custom']),
      body('description').optional().isString().isLength({ max: 255 }),
    ],
    async (req: Request, res: Response): Promise<void> => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { key } = req.params;
      const updated = await configService.updateConfig(key, req.body);

      if (!updated) {
        res.status(404).json({ error: 'Config not found', key });
        return;
      }

      res.json(updated);
    },
  );

  // DELETE /config/:key — Remove a config
  router.delete(
    '/config/:key',
    [param('key').notEmpty()],
    async (req: Request, res: Response): Promise<void> => {
      const { key } = req.params;
      const deleted = await configService.deleteConfig(key);

      if (!deleted) {
        res.status(404).json({ error: 'Config not found', key });
        return;
      }

      res.status(204).send();
    },
  );

  // GET /configs — List all stored configs
  router.get('/configs', async (_req: Request, res: Response): Promise<void> => {
    const configs = await configService.listConfigs();
    res.json({ configs, total: configs.length });
  });

  return router;
}
