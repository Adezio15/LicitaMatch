import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const postgresUrl = z.string().url().refine(value => /^postgres(?:ql)?:\/\//.test(value), 'Use uma URL PostgreSQL');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOCAL_DATABASE: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_TIMEZONE: z.literal('America/Fortaleza').default('America/Fortaleza'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: postgresUrl,
  SESSION_SECRET: z.string().min(48).refine(value => !/CHANGE_ME|SUBSTITUA|troque/i.test(value), 'Gere um segredo aleatório'),
  DATABASE_DIRECT_URL: z.preprocess(value => value === '' ? undefined : value, postgresUrl.optional()),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000)
}).refine(config => config.NODE_ENV !== 'production' || config.LOCAL_DATABASE === 'false', {
  path: ['LOCAL_DATABASE'], message: 'Banco local não pode ser ativado em produção'
});

export function parseEnv(input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Nunca incluir valores recebidos: URLs podem conter credenciais.
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))];
    const error = new Error(`Configuração inválida: ${fields.join(', ')}. Consulte .env.example.`);
    error.code = 'INVALID_ENV';
    error.fields = fields;
    throw error;
  }
  return Object.freeze(result.data);
}
