import pg from 'pg';
import { loadEnvironment, parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { safeError } from '../src/utils/safeError.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';
import { inspectDatabase, checkDatabase, requiredTables } from '../src/services/databaseCheckService.js';

const logger = createLogger();
let client;
let stage = 'environment';
try {
  loadEnvironment(logger);
  const config = parseEnv(process.env);
  const target = config.DATABASE_DIRECT_URL ? 'DATABASE_DIRECT_URL' : 'DATABASE_URL';
  logger.info({ target }, 'Conexão selecionada para migrations');
  stage = 'migration_connection';
  client = new pg.Client({
    connectionString: config.DATABASE_DIRECT_URL || config.DATABASE_URL,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
    options: '-c timezone=UTC',
    statement_timeout: 60000,
    application_name: 'licitamatch-migrations'
  });
  await client.connect();
  stage = 'migration_inspection';
  const before = await inspectDatabase(client);
  logger.info({ target, ...before }, 'Schema antes das migrations (somente leitura)');
  stage = 'migrations';
  const applied = await runMigrations(client, await readMigrations());
  // Log the committed migrations even if the subsequent schema check fails.
  logger.info({ applied }, 'Migrations aplicadas e confirmadas');
  stage = 'migration_verification';
  const verified = await checkDatabase(client);
  logger.info({ target, applied, tablesBefore: before.presentTables, tablesAfter: requiredTables, ...verified }, 'Migrations concluídas; SELECT 1, tabelas e checksums validados');
} catch (error) {
  logger.error({ stage, error: safeError(error), fields: error.code === 'INVALID_ENV' ? error.fields : undefined, issues: error.code === 'INVALID_ENV' ? error.issues : undefined }, 'Falha nas migrations. Verifique configuração, conexão e integridade dos arquivos SQL.');
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.end(); }
    catch (error) {
      logger.error({ stage: 'cleanup', error: safeError(error) }, 'Falha ao encerrar conexão');
      process.exitCode = 1;
    }
  }
}
