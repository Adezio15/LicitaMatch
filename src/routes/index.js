import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';

export function createRoutes(database, logger) {
  const router = Router();
  const health = healthController(database, logger);
  router.get('/health/live', health.live);
  router.get('/health/ready', health.ready);
  return router;
}
