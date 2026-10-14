import { whatsappEligibilitySql } from '../services/whatsappAlertsService.js';
import { Router } from 'express';
import twilio from 'twilio';
import { normalizeWhatsAppNumber } from '../services/whatsappService.js';
import { sandboxAllowed, WELCOME } from '../services/twilioWhatsAppService.js';

export function whatsappRoutes({ config, database, logger }) {
  const router = Router();
  router.post('/api/whatsapp/webhook', async (req,res) => {
    // Log only fixed reason codes and the server-generated request ID. Never log
    // headers, URLs/queries, form values, phone numbers or provider errors.
    const diagnostic = (reason, status, level = 'warn') => logger[level]({
      event: 'whatsapp.webhook.decision', requestId: req.id, reason, status
    }, 'Resultado da validação do webhook WhatsApp');
    const reject = (status, reason) => {
      diagnostic(reason, status);
      return res.sendStatus(status);
    };
    const empty = reason => {
      diagnostic(reason, 200, 'info');
      return res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
    };
    if (!config.TWILIO_AUTH_TOKEN) return reject(503, 'auth_token_missing');
    if (!req.is('application/x-www-form-urlencoded')) return reject(415, 'unsupported_content_type');
    // Use the configured external URL, including its exact query. Never trust proxy/Host headers.
    const url = config.WHATSAPP_WEBHOOK_URL || 'https://licitamatch.online/api/whatsapp/webhook';
    const publicUrl = new URL(url);
    if (req.originalUrl !== publicUrl.pathname + publicUrl.search) return reject(403, 'public_url_mismatch');
    const signature = req.get('X-Twilio-Signature');
    if (!signature) return reject(403, 'signature_missing');
    // For form webhooks the SDK signs ALL decoded form parameters, not the raw
    // bytes. Do not trim, normalize or filter req.body before this validation.
    if (!twilio.validateRequest(config.TWILIO_AUTH_TOKEN,signature,url,req.body || {})) return reject(403, 'signature_invalid');
    if (req.body.AccountSid !== config.TWILIO_ACCOUNT_SID) return reject(403, 'account_sid_mismatch');
    if (req.body.To !== config.TWILIO_WHATSAPP_FROM) return reject(403, 'recipient_mismatch');
    if (typeof req.body.MessageSid !== 'string' || !/^SM[0-9a-fA-F]{32}$/.test(req.body.MessageSid)) return reject(400, 'message_sid_invalid');
    if (typeof req.body.From !== 'string' || !/^whatsapp:\+/.test(req.body.From)) return reject(400, 'sender_invalid');
    let number;
    try { number = normalizeWhatsAppNumber(req.body.From.slice(9)); } catch { return reject(400, 'sender_invalid'); }
    if (!number) return reject(400, 'sender_invalid');
    if (config.WHATSAPP_WEBHOOK_ENABLED !== 'true') return empty('webhook_disabled');
    if ((config.WHATSAPP_MODE || 'sandbox') === 'sandbox' && !sandboxAllowed(config,number)) return empty('sandbox_number_not_allowed');
    try {
      const eligible = await database.query("SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE u.whatsapp_numero=$1 AND "+whatsappEligibilitySql+" LIMIT 1",[number]);
      if (!eligible.rows.length) return empty('sender_not_eligible');
      const record = await database.query("INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING mensagem_id",[req.body.MessageSid,number]);
      const response = new twilio.twiml.MessagingResponse();
      if (record.rows.length) response.message(WELCOME);
      diagnostic(record.rows.length ? 'welcome_replied' : 'duplicate_message', 200, 'info');
      return res.type('text/xml').send(response.toString());
    } catch {
      logger.error({event:'whatsapp.webhook.failed',requestId:req.id,reason:'database_failure',status:503},'Falha ao registrar mensagem WhatsApp');
      return res.sendStatus(503);
    }
  });
  return router;
}
