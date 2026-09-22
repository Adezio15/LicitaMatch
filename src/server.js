import { loadEnvironment, parseEnv } from './config/env.js';
import { createDatabase } from './config/database.js';
import { createLogger } from './utils/logger.js';
import { safeError } from './utils/safeError.js';
import { checkDatabase } from './services/databaseCheckService.js';

const logger = createLogger();
let database;
let operationsDatabase;
let app;
let stage = 'environment';
async function closeResources() {
  await app?.locals.operations?.stop();
  for (const resource of [app?.locals.sessionStore, operationsDatabase !== database ? operationsDatabase : null, database]) {
    if (!resource) continue;
    try {
      if (resource === database || resource === operationsDatabase) await resource.end();
      else await resource.close();
    } catch (error) {
      if (logger.level === 'silent') logger.level = 'fatal';
      logger.fatal({ stage: 'cleanup', error: safeError(error) }, 'Falha ao encerrar recursos');
      process.exitCode = 1;
    }
  }
}
try {
  loadEnvironment(logger);
  const config = parseEnv(process.env);
  logger.level = config.LOG_LEVEL;
  stage = 'database_connection';
  database = createDatabase(config, logger);
  await database.query('SELECT 1');
  logger.info('Conexão PostgreSQL validada com SELECT 1');
  stage = 'database_schema';
  logger.info(await checkDatabase(database), 'Tabelas e migrations verificadas');
  stage = 'application';
  const { createApp } = await import('./app.js');
  operationsDatabase = config.DATABASE_DIRECT_URL
    ? createDatabase({ ...config, DATABASE_URL: config.DATABASE_DIRECT_URL, DATABASE_POOL_MAX: 2 },logger) : database;
  app = createApp({ config, database, operationsDatabase, logger });
  stage = 'http_listen';
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT, timezone: config.APP_TIMEZONE }, 'LicitaMatch iniciado');
    app.locals.operations.start();
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      await closeResources();
      clearTimeout(timeout);
      logger.info('Servidor encerrado');
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', async error => {
    if (logger.level === 'silent') logger.level = 'fatal';
    logger.fatal({ stage, error: safeError(error) }, 'Não foi possível iniciar o servidor HTTP');
    process.exitCode = 1;
    await closeResources();
  });
} catch (error) {
  // Even LOG_LEVEL=silent must not hide a fatal startup failure.
  if (logger.level === 'silent') logger.level = 'fatal';
  logger.fatal({ stage, error: safeError(error), fields: error.code === 'INVALID_ENV' ? error.fields : undefined, issues: error.code === 'INVALID_ENV' ? error.issues : undefined }, 'Falha ao iniciar. Verifique variáveis de ambiente e conexão PostgreSQL.');
  process.exitCode = 1;
  await closeResources();
}
