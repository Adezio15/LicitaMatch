import { parseEnv } from './config/env.js';
import { createDatabase } from './config/database.js';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';

const logger = createLogger();
let database;
try {
  const config = parseEnv(process.env);
  logger.level = config.LOG_LEVEL;
  database = createDatabase(config, logger);
  await database.query('SELECT 1');
  const app = createApp({ config, database, logger });
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT, timezone: config.APP_TIMEZONE }, 'LicitaMatch iniciado');
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      await app.locals.sessionStore.close();
      await database.end();
      clearTimeout(timeout);
      logger.info('Servidor encerrado');
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', async error => {
    logger.fatal({ code: error.code }, 'Não foi possível iniciar o servidor HTTP');
    await database.end();
    process.exitCode = 1;
  });
} catch (error) {
  logger.fatal({ code: error.code }, 'Falha ao iniciar. Verifique variáveis de ambiente e conexão PostgreSQL.');
  if (database) await database.end();
  process.exitCode = 1;
}
