import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: ['BREVO_API_KEY', '*.BREVO_API_KEY', 'SMTP_PASSWORD', '*.SMTP_PASSWORD', 'auth.pass', 'password', 'senha', 'senha_atual', 'senha_hash', 'SESSION_SECRET', 'SEED_USER_PASSWORD', 'DATABASE_URL', 'DATABASE_DIRECT_URL', 'req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]'
    }
  });
}
