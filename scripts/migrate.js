import pg from 'pg';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';

const logger = createLogger();
let client;
try {
  const config = parseEnv(process.env);
  client = new pg.Client({
    connectionString: config.DATABASE_DIRECT_URL || config.DATABASE_URL,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
    options: '-c timezone=UTC',
    statement_timeout: 60000,
    application_name: 'licitamatch-migrations'
  });
  await client.connect();
  const applied = await runMigrations(client, await readMigrations());
  logger.info({ applied }, 'Migrations concluídas');
} catch (error) {
  logger.error({ code: error.code }, 'Falha nas migrations. Verifique configuração, conexão e integridade dos arquivos SQL.');
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
