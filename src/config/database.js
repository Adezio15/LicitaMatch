import pg from 'pg';

export function createDatabase(config, logger) {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    options: '-c timezone=UTC',
    application_name: 'licitamatch'
  });
  pool.on('error', error => logger.error({ code: error.code }, 'Erro em conexão ociosa do banco'));
  return pool;
}
