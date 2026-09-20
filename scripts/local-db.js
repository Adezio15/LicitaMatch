import { localEnvironment, setupLocalDatabase, stopLocalDatabase, localDatabaseStatus } from './lib/localPostgres.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger();
try {
  const action = process.argv[2] || 'status';
  if (action === 'ensure') {
    const { values } = await localEnvironment();
    if (values.NODE_ENV === 'production') throw new Error('Em produção use npm start. O comando dev é exclusivo de desenvolvimento.');
    if (values.LOCAL_DATABASE === 'true') await setupLocalDatabase(logger);
  } else if (['setup', 'start'].includes(action)) {
    await setupLocalDatabase(logger);
  } else if (action === 'stop') {
    await stopLocalDatabase(logger);
  } else if (action === 'status') {
    await localDatabaseStatus(logger);
  } else throw new Error('Comando local desconhecido. Use setup, start, stop ou status.');
} catch (error) {
  logger.error({ code: error.code }, error.code ? 'Falha no banco local. Verifique .local/postgres/postgres.log.' : error.message);
  process.exitCode = 1;
}
