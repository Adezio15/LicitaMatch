import pg from 'pg';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { safeError } from '../src/utils/safeError.js';
import { checkDatabase } from '../src/services/databaseCheckService.js';

const logger = createLogger();
let stage = 'environment';
try {
  const config = parseEnv(process.env);
  logger.info({ directUrlConfigured: Boolean(config.DATABASE_DIRECT_URL) }, 'Variáveis válidas; DATABASE_DIRECT_URL é opcional e usa DATABASE_URL quando ausente');
  for (const target of ['DATABASE_URL', ...(config.DATABASE_DIRECT_URL ? ['DATABASE_DIRECT_URL'] : [])]) {
    stage = target;
    const client = new pg.Client({
      connectionString: config[target],
      connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
      statement_timeout: 15000,
      application_name: 'licitamatch-deploy-check'
    });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      const result = await checkDatabase(client);
      await client.query('ROLLBACK');
      logger.info({ target, ...result }, 'Conexão, tabelas e migrations verificadas em modo somente leitura');
    } finally {
      try { await client.end(); }
      catch (error) {
        logger.error({ stage: 'cleanup', error: safeError(error) }, 'Falha ao encerrar conexão');
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  logger.error({ stage, error: safeError(error), fields: error.code === 'INVALID_ENV' ? error.fields : undefined, issues: error.code === 'INVALID_ENV' ? error.issues : undefined }, 'Diagnóstico de deploy falhou');
  process.exitCode = 1;
}
