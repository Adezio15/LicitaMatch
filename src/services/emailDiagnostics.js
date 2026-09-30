import nodemailer from 'nodemailer';
import { emailProvider, emailFields } from '../config/email.js';
import { createBrevoTransport } from './brevoTransport.js';
import { createResendTransport } from './emailService.js';
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

export function emailTransport(config, { fetchImpl = globalThis.fetch, transportFactory = smtpTransport } = {}) {
  const provider = emailProvider(config);
  if (provider === 'brevo_api') return createBrevoTransport({ apiKey: config.BREVO_API_KEY, fetchImpl });
  if (provider === 'resend') return createResendTransport({ apiKey: config.RESEND_API_KEY, fetchImpl });
  return transportFactory(config);
}

export function emailError(error, config) {
  const env = { ...process.env, ...config };
  const secrets = [config.SMTP_PASSWORD, config.SMTP_PASSWORD && Buffer.from(config.SMTP_PASSWORD).toString('base64'),
    config.SMTP_PASSWORD && Buffer.from(`\0${config.SMTP_USER}\0${config.SMTP_PASSWORD}`).toString('base64')].filter(Boolean);
  secrets.forEach((value, i) => { env[`SMTP_SECRET_${i}`] = value; });
  const result = safeError(error, env);
  for (const key of ['statusCode', 'command', 'response', 'responseCode', 'errno', 'syscall', 'address', 'port']) {
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
      stage = provider === 'brevo_api' ? 'api' : 'sendMail';
      logger.info({ ...context, event: provider === 'brevo_api' ? 'email.api.start' : 'email.sendMail.start' }, 'Início de sendMail()');
      const result = await transport.sendMail(payload);
      if (result?.accepted === false || (Array.isArray(result?.accepted) && !result.accepted.length) || result?.rejected?.length) {
        throw new Error('O servidor não aceitou o destinatário.');
      }
      logger.info({ ...context, event: provider === 'brevo_api' ? 'email.api.success' : 'email.sent', messageId: result?.messageId, statusCode: result?.statusCode }, 'E-mail aceito pelo provedor');
      return result;
    } catch (error) {
      logger.error({ ...context, event: provider === 'brevo_api' ? 'email.api.failed' : 'email.failed', stage,
        ...(provider === 'smtp' && error?.code === 'ETIMEDOUT' && error?.command === 'CONN' ? { connectionEstablished: false } : {}), error: emailError(error, config) }, 'Falha no envio de e-mail');
      throw error;
    }
  } };
}

export async function sendTestEmail({ config, logger, to, requestId, transportFactory = smtpTransport, fetchImpl = globalThis.fetch }) {
  const provider = emailProvider(config);
  logger.info({ event: 'email.test.start', provider, requestId, recipient: to }, 'Teste de e-mail solicitado');
  let transport;
  try {
    if (typeof to !== 'string' || to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Destinatario invalido.');
    const missing = emailFields(config).filter(key => !config[key]);
    if (missing.length) throw new Error(`Configuracao ausente: ${missing.join(', ')}.`);
    transport = emailTransport(config, { transportFactory, fetchImpl });
    return await diagnosticTransport({ transport, config, logger, provider }).sendMail({
      from: config.EMAIL_FROM, to, subject: 'LicitaMatch - e-mail de teste',
      text: 'Teste de envio do LicitaMatch solicitado na pagina de Operacao.',
      html: '<p>Teste de envio do LicitaMatch solicitado na pagina de Operacao.</p>'
    });
  } catch (error) {
    logger.error({ event: provider === 'brevo_api' && !transport ? 'email.api.failed' : 'email.test.failed', provider, requestId, error: emailError(error, config) }, 'Teste de e-mail falhou');
    throw error;
  } finally { transport?.close?.(); }
}
