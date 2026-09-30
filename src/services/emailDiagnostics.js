import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { safeError } from '../utils/safeError.js';

const smtpSecure = config => config.SMTP_SECURE === undefined
  ? Number(config.SMTP_PORT) === 465 : config.SMTP_SECURE === 'true';

export function smtpTransport(config) {
  return nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT,
    secure: smtpSecure(config), requireTLS: true,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true });
}

export function emailError(error, config) {
  const env = { ...process.env, ...config };
  const secrets = [config.SMTP_PASSWORD, config.SMTP_PASSWORD && Buffer.from(config.SMTP_PASSWORD).toString('base64'),
    config.SMTP_PASSWORD && Buffer.from(`\0${config.SMTP_USER}\0${config.SMTP_PASSWORD}`).toString('base64')].filter(Boolean);
  secrets.forEach((value, i) => { env[`SMTP_SECRET_${i}`] = value; });
  const result = safeError(error, env);
  for (const key of ['command', 'response', 'responseCode', 'errno', 'syscall', 'address', 'port']) {
    if (error?.[key] !== undefined) result[key] = safeError({ message: error[key] }, env).message;
  }
  if (error?.cause && error.cause !== error) result.cause = safeError(error.cause, env);
  return result;
}

export function diagnosticTransport({ transport, config, logger, provider = 'smtp' }) {
  return { async sendMail(payload) {
    const context = { deliveryId: randomUUID(), provider, recipient: payload.to,
      ...(provider === 'smtp' ? { SMTP_HOST: config.SMTP_HOST, SMTP_PORT: config.SMTP_PORT, SMTP_SECURE: smtpSecure(config), SMTP_USER: config.SMTP_USER } : {}) };
    let stage = 'start';
    logger.info({ ...context, event: 'email.start' }, 'Início da função de envio');
    try {
      if (provider === 'smtp') {
        stage = 'verify';
        logger.info({ ...context, event: 'email.verify.start' }, 'Início de transporter.verify()');
        const verified = await transport.verify();
        logger.info({ ...context, event: 'email.verify.result', verified, connectionEstablished: verified === true },
          verified === true ? 'Conexão SMTP estabelecida; TLS e autenticação verificados' : 'Verificação SMTP não confirmada');
      }
      stage = 'sendMail';
      logger.info({ ...context, event: 'email.sendMail.start' }, 'Início de sendMail()');
      const result = await transport.sendMail(payload);
      if (result?.accepted === false || (Array.isArray(result?.accepted) && !result.accepted.length) || result?.rejected?.length) {
        throw new Error('O servidor não aceitou o destinatário.');
      }
      logger.info({ ...context, event: 'email.sent', messageId: result?.messageId }, 'E-mail aceito pelo provedor');
      return result;
    } catch (error) {
      logger.error({ ...context, event: 'email.failed', stage,
        ...(provider === 'smtp' && error?.code === 'ETIMEDOUT' && error?.command === 'CONN' ? { connectionEstablished: false } : {}), error: emailError(error, config) }, 'Falha no envio de e-mail');
      throw error;
    }
  } };
}

export async function sendTestEmail({ config, logger, to, requestId, transportFactory = smtpTransport }) {
  logger.info({ event: 'email.test.start', requestId, recipient: to,
    SMTP_HOST: config.SMTP_HOST, SMTP_PORT: config.SMTP_PORT, SMTP_SECURE: smtpSecure(config), SMTP_USER: config.SMTP_USER }, 'Teste SMTP solicitado');
  let transport;
  try {
    if (typeof to !== 'string' || to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Destinatário inválido.');
    const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'].filter(key => !config[key]);
    if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}.`);
    transport = transportFactory(config);
    return await diagnosticTransport({ transport, config, logger }).sendMail({
      from: config.EMAIL_FROM, to, subject: 'LicitaMatch — e-mail de teste',
      text: 'Teste de envio SMTP do LicitaMatch solicitado na página de Operação.'
    });
  } catch (error) {
    logger.error({ event: 'email.test.failed', requestId, error: emailError(error, config) }, 'Teste SMTP falhou');
    throw error;
  } finally { transport?.close?.(); }
}
