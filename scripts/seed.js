import dotenv from 'dotenv';
import { parseEnv } from '../src/config/env.js';
import { createDatabase } from '../src/config/database.js';
import { createLogger } from '../src/utils/logger.js';
import { seedDevelopment } from '../src/services/seedService.js';

dotenv.config({ quiet: true });

const logger = createLogger();
let database;
try {
  if (process.env.NODE_ENV !== 'development') throw new Error('Seed permitido somente com NODE_ENV=development explícito.');
  if (!process.env.SEED_USER_PASSWORD) throw new Error('Defina SEED_USER_PASSWORD com pelo menos 12 caracteres no .env.');
  const config = parseEnv(process.env);
  database = createDatabase(config, logger);
  const created = await seedDevelopment(database, process.env);
  logger.info({ created }, created ? 'Empresa Exemplo e usuário gestor criados.' : 'Seed já existe; nenhum cadastro ou senha foi alterado.');
} catch (error) {
  logger.error({ code: error.code }, error.code ? 'Falha no seed. Verifique migrations e banco.' : error.message);
  process.exitCode = 1;
} finally { if (database) await database.end(); }
