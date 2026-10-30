import { Router } from 'express';
import type { HealthResponse } from '@clinic/shared';

export type DbCheck = () => Promise<void>;

/** GET /api/health — DB connectivity only; never exposes versions or errors (SPEC §12.5). */
export function healthRoutes(checkDb: DbCheck): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      await checkDb();
      res.json({ status: 'ok' } satisfies HealthResponse);
    } catch (err) {
      req.log?.error({ err }, 'health check failed');
      res.status(503).json({ status: 'error' } satisfies HealthResponse);
    }
  });
  return router;
}
