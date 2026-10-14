import { brazilWhatsAppNumberRegex } from '../services/brazilWhatsAppNumber.js';
import dotenv from 'dotenv';
import { emailProvider, emailFields } from './email.js';
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
  SENAC_ENABLED: z.enum(['true','false']).default('true'),
  SESC_ENABLED: z.enum(['true','false']).default('true'),
  RECIFE_ENABLED: z.enum(['true','false']).default('true'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(2),
  SYNC_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(5),
  PNCP_MODALIDADES: z.string().regex(/^\d+(,\d+)*$/).default('4,6,7,8,9,12'),
  COMPRASNET_MODALIDADES: z.string().regex(/^\d+(,\d+)*$/).default('3,5,6,7'),
  EMAIL_ENABLED: z.enum(['true','false']).default('false'),
  BREVO_API_KEY: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().trim().min(1).optional()),
  EMAIL_PROVIDER: z.enum(['smtp','resend','brevo_api']).default('smtp'),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  WHATSAPP_SANDBOX_TEST_ENABLED: z.enum(['true','false']).default('false'),
  WHATSAPP_ENABLED: z.enum(['true','false']).default('false'),
  WHATSAPP_WEBHOOK_ENABLED: z.enum(['true','false']).default('false'),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-fA-F]{32}$/).optional(),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1).optional(),
  TWILIO_WHATSAPP_FROM: z.string().regex(/^whatsapp:\+[1-9]\d{7,14}$/).optional(),
  TWILIO_WHATSAPP_CONTENT_SID: z.string().regex(/^HX[0-9a-fA-F]{32}$/).optional(),
  WHATSAPP_WEBHOOK_URL: z.string().url().default('https://licitamatch.online/api/whatsapp/webhook'),
  WHATSAPP_MODE: z.enum(['sandbox','production']).default('sandbox'),
  WHATSAPP_SANDBOX_NUMBERS: z.string().default('').refine(value => !value || value.split(',').every(n => brazilWhatsAppNumberRegex.test(n.trim()))),
  WHATSAPP_PRODUCTION_READY: z.enum(['true','false']).default('false'),
  ADMIN_EMAIL: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, z.string().trim().email().optional()),
  EMAIL_FROM: z.string().email().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
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
  const webhook = URL.canParse(config.WHATSAPP_WEBHOOK_URL) ? new URL(config.WHATSAPP_WEBHOOK_URL) : {};
  if (webhook.protocol !== 'https:' || webhook.username || webhook.password || webhook.hash || webhook.pathname !== '/api/whatsapp/webhook')
    ctx.addIssue({code:'custom',path:['WHATSAPP_WEBHOOK_URL'],message:'INVALID_PUBLIC_WEBHOOK'});
  if (config.WHATSAPP_ENABLED === 'true' && config.WHATSAPP_MODE === 'production') {
    for (const field of ['TWILIO_WHATSAPP_CONTENT_SID','WHATSAPP_PRODUCTION_READY']) {
      if (!config[field] || (field === 'WHATSAPP_PRODUCTION_READY' && config[field] !== 'true'))
        ctx.addIssue({code:'custom',path:[field],message:'PRODUCTION_NOT_READY'});
    }
  }
  if (config.EMAIL_ENABLED === 'true') for (const field of emailFields(config)) {
    if (!config[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'MISSING' });
  }
  if (config.WHATSAPP_SANDBOX_TEST_ENABLED === 'true' && (config.WHATSAPP_ENABLED !== 'false' || config.WHATSAPP_PRODUCTION_READY !== 'false' || config.WHATSAPP_MODE !== 'sandbox'))
    ctx.addIssue({code:'custom',path:['WHATSAPP_SANDBOX_TEST_ENABLED'],message:'SANDBOX_TEST_REQUIRES_DISABLED_PRODUCTION'});
  if (config.WHATSAPP_ENABLED === 'true' || config.WHATSAPP_WEBHOOK_ENABLED === 'true' || config.WHATSAPP_SANDBOX_TEST_ENABLED === 'true') for (const field of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_WHATSAPP_FROM']) {
    if (!config[field]) ctx.addIssue({code:'custom',path:[field],message:'MISSING'});
  }
}).refine(config => config.NODE_ENV !== 'production' || config.LOCAL_DATABASE === 'false', {
  path: ['LOCAL_DATABASE'], message: 'Banco local não pode ser ativado em produção'
});

export function parseEnv(input) {
  const normalizedInput = { ...input };
  normalizedInput.COMPRASNET_ENABLED ??= 'true';
  normalizedInput.EMAIL_PROVIDER = emailProvider(normalizedInput);
  for (const [flag, fields] of Object.entries({
    EMAIL_ENABLED: emailFields(normalizedInput)
  })) normalizedInput[flag] ??= fields.every(field => typeof normalizedInput[field] === 'string' && normalizedInput[field].trim()) ? 'true' : 'false';
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
