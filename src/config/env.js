import dotenv from 'dotenv';
import { z } from 'zod';

// Called explicitly by entrypoints before validation. Importing this module does
// not read files or mutate process.env. Railway injects variables into the process.
export function loadEnvironment(logger) {
  const railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID);
  if (process.env.NODE_ENV !== 'production' && !railway) {
    dotenv.config({ quiet: true, override: false });
  }
  // Temporary startup diagnostic: existence only, never values or lengths.
  logger?.info(`DATABASE_URL presente: ${process.env.DATABASE_URL !== undefined}`);
  logger?.info(`SESSION_SECRET presente: ${process.env.SESSION_SECRET !== undefined}`);
}

const invalid = (ctx, reason) => ctx.addIssue({ code: 'custom', message: reason });
export const postgresUrl = z.string().superRefine((value, ctx) => {
  if (!value) return invalid(ctx, 'EMPTY');
  if (value !== value.trim()) return invalid(ctx, 'SURROUNDING_WHITESPACE');
  if (/^(?:psql\b|(?:export\s+)?DATABASE(?:_DIRECT)?_URL\s*=)/i.test(value)) return invalid(ctx, 'COMMAND_INSTEAD_OF_URL');
  if (/^['"`]/.test(value)) return invalid(ctx, 'QUOTED_VALUE');
  if (/^\$\{/.test(value)) return invalid(ctx, 'UNRESOLVED_REFERENCE');
  let url;
  try { url = new URL(value); }
  catch { return invalid(ctx, 'MALFORMED_URL'); }
  // WHATWG URL normalizes the protocol only for this check. Preserve the original
  // string, credentials and all query parameters for node-postgres.
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !/^postgres(?:ql)?:\/\//i.test(value)) {
    return invalid(ctx, 'POSTGRES_PROTOCOL_REQUIRED');
  }
  if (!url.hostname) return invalid(ctx, 'HOST_REQUIRED');
});

const sessionSecret = z.string().min(48).superRefine((value, ctx) => {
  if (/CHANGE_ME|SUBSTITUA|troque/i.test(value)) return invalid(ctx, 'PLACEHOLDER_SECRET');
  if (!value.trim() || /^(.)\1+$/s.test(value)) return invalid(ctx, 'WEAK_SECRET');
});
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOCAL_DATABASE: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_TIMEZONE: z.literal('America/Fortaleza').default('America/Fortaleza'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  WORKER_ENABLED: z.enum(['true','false']).default('true'),
  SYNC_ENABLED: z.enum(['true','false']).default('true'),
  COMPRASNET_ENABLED: z.enum(['true','false']).default('false'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(2),
  SYNC_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(5),
  PNCP_MODALIDADES: z.string().regex(/^\d+(,\d+)*$/).default('4,6,7,8,9,12'),
  COMPRASNET_MODALIDADES: z.string().regex(/^\d+(,\d+)*$/).default('3,5,6,7'),
  EMAIL_ENABLED: z.enum(['true','false']).default('false'),
  WHATSAPP_ENABLED: z.enum(['true','false']).default('false'),
  WHATSAPP_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.0$/).optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/).default('pt_BR'),
  EMAIL_FROM: z.string().email().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  ALERT_MIN_SCORE: z.coerce.number().int().min(1).max(100).default(70),
  DATABASE_URL: postgresUrl,
  SESSION_SECRET: sessionSecret,
  DATABASE_DIRECT_URL: z.preprocess(value => value === '' ? undefined : value, postgresUrl.optional()),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000)
}).superRefine((config,ctx) => {
  if (config.WORKER_ENABLED === 'true' && postgresUrl.safeParse(config.DATABASE_URL).success) {
    const pooled = value => new URL(value).hostname.includes('-pooler.');
    if ((pooled(config.DATABASE_URL) && !config.DATABASE_DIRECT_URL) ||
        (config.DATABASE_DIRECT_URL && postgresUrl.safeParse(config.DATABASE_DIRECT_URL).success && pooled(config.DATABASE_DIRECT_URL))) {
      ctx.addIssue({code:'custom',path:['DATABASE_DIRECT_URL'],message:'WORKER_REQUIRES_DIRECT_CONNECTION'});
    }
  }
  if (config.NODE_ENV === 'production' && config.EMAIL_ENABLED === 'true') for (const field of ['EMAIL_FROM','SMTP_HOST','SMTP_USER','SMTP_PASSWORD']) {
    if (!config[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'MISSING' });
  }
  if (config.NODE_ENV === 'production' && config.WHATSAPP_ENABLED === 'true') for (const field of ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE_NAME']) {
    if (!config[field]) ctx.addIssue({code:'custom',path:[field],message:'MISSING'});
  }
}).refine(config => config.NODE_ENV !== 'production' || config.LOCAL_DATABASE === 'false', {
  path: ['LOCAL_DATABASE'], message: 'Banco local não pode ser ativado em produção'
});

export function parseEnv(input) {
  const normalizedInput = { ...input };
  if (normalizedInput.NODE_ENV === 'production') {
    if (normalizedInput.COMPRASNET_ENABLED === undefined) normalizedInput.COMPRASNET_ENABLED = 'false';
    if (normalizedInput.EMAIL_ENABLED === undefined) normalizedInput.EMAIL_ENABLED = 'false';
    if (normalizedInput.WHATSAPP_ENABLED === undefined) normalizedInput.WHATSAPP_ENABLED = 'false';
  } else {
    if (normalizedInput.COMPRASNET_ENABLED === undefined) normalizedInput.COMPRASNET_ENABLED = 'true';
    if (normalizedInput.EMAIL_ENABLED === undefined) normalizedInput.EMAIL_ENABLED = 'true';
    if (normalizedInput.WHATSAPP_ENABLED === undefined) normalizedInput.WHATSAPP_ENABLED = 'true';
  }
  const result = schema.safeParse(normalizedInput);
  if (!result.success) {
    // Nunca incluir valores recebidos: URLs podem conter credenciais.
    const issues = result.error.issues.map(issue => ({
      field: issue.path.join('.'),
      // Never log Zod's raw issue/input or interpolate the supplied value.
      reason: issue.code === 'custom' && /^[A-Z_]+$/.test(issue.message) ? issue.message :
        issue.code === 'invalid_type' ? (input?.[issue.path[0]] === undefined ? 'MISSING' : 'INVALID_TYPE') :
        issue.code === 'too_small' && issue.path[0] === 'SESSION_SECRET' ? 'MIN_48_CHARACTERS' : 'INVALID_VALUE'
    }));
    const fields = [...new Set(issues.map(issue => issue.field))];
    const error = new Error(`Configuração inválida: ${issues.map(issue => `${issue.field} (${issue.reason})`).join(', ')}. Consulte .env.example.`);
    error.code = 'INVALID_ENV';
    error.fields = fields;
    error.issues = issues;
    throw error;
  }
  return Object.freeze(result.data);
}
