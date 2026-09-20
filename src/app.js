import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRoutes } from './routes/index.js';
import { accountRoutes } from './routes/accountRoutes.js';
import { createSession } from './config/session.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp({ config, database, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.set('view engine', 'ejs');
  app.use(helmet());
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.on('finish', () => logger.info({ requestId: req.id, method: req.method, status: res.statusCode }, 'Requisição concluída'));
    next();
  });
  app.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: req => req.path === '/health/live' || req.path === '/health/ready',
    message: { error: 'Muitas requisições. Tente novamente em instantes.' }
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(createRoutes(database, logger));
  app.use('/assets', express.static(fileURLToPath(new URL('./public', import.meta.url))));
  const sessions = createSession({ config, database, logger });
  app.locals.sessionStore = sessions.store;
  app.use(sessions.middleware);
  app.use(accountRoutes(database, config));
  app.use((_req, res) => res.status(404).json({ error: 'Página não encontrada' }));
  app.use(errorHandler(logger));
  return app;
}
