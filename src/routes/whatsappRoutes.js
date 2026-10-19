import { whatsappEligibilitySql } from '../services/whatsappAlertsService.js';
import { Router } from 'express';
import twilio from 'twilio';
import { normalizeWhatsAppSender } from '../services/whatsappService.js';
import { sandboxAllowed } from '../services/twilioWhatsAppService.js';

export function whatsappRoutes({ config, database, logger }) {
  const router = Router();
  router.post('/api/whatsapp/webhook', async (req,res) => {
    // Log only fixed reason codes and the server-generated request ID. Never log
    // headers, URLs/queries, form values, phone numbers or provider errors.
    const diagnostic = (reason, status, level = 'warn', senderReason) => logger[level]({
      event: 'whatsapp.webhook.decision', requestId: req.id, reason, status, senderReason
    }, 'Resultado da validação do webhook WhatsApp');
    const reject = (status, reason, senderReason) => {
      diagnostic(reason, status, 'warn', senderReason);
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
    let number;
    try { number = normalizeWhatsAppSender(req.body.From); } catch (error) { return reject(400, 'sender_invalid', error.code); }
    if (!number) return reject(400, 'sender_invalid');
    const cancel = req.body.OptOutType === 'STOP' || (typeof req.body.Body === 'string' && /^(stop|sair|parar|cancelar|cancelar notificações)$/iu.test(req.body.Body.trim()));
    if (cancel) {
      try {
        await database.query(`WITH recorded AS (
          INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)
          ON CONFLICT DO NOTHING RETURNING mensagem_id)
          UPDATE usuarios SET alertas_whatsapp=false,whatsapp_consentimento_em=NULL
          WHERE whatsapp_numero=$2 AND EXISTS (SELECT 1 FROM recorded)`,[req.body.MessageSid,number]);
        return empty('consent_revoked');
      } catch { return reject(503,'database_failure'); }
    }
    if (config.WHATSAPP_WEBHOOK_ENABLED !== 'true') return empty('webhook_disabled');
    if ((config.WHATSAPP_MODE || 'sandbox') === 'sandbox' && !sandboxAllowed(config,number)) return empty('sandbox_number_not_allowed');
    try {
      const eligible = await database.query("SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE u.whatsapp_numero=$1 AND "+whatsappEligibilitySql+" LIMIT 1",[number]);
      if (!eligible.rows.length) return empty('sender_not_eligible');
      const record = await database.query("INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING mensagem_id",[req.body.MessageSid,number]);
      const response = new twilio.twiml.MessagingResponse();
      // Notifications only: never generate a conversational reply.
      diagnostic(record.rows.length ? 'inbound_recorded' : 'duplicate_message', 200, 'info');
      return res.type('text/xml').send(response.toString());
    } catch {
      logger.error({event:'whatsapp.webhook.failed',requestId:req.id,reason:'database_failure',status:503},'Falha ao registrar mensagem WhatsApp');
      return res.sendStatus(503);
    }
  });
  router.post('/api/whatsapp/status', async (req,res) => {
    const url = config.WHATSAPP_STATUS_CALLBACK_URL || 'https://licitamatch.online/api/whatsapp/status';
    const publicUrl = new URL(url);
    if (!config.TWILIO_AUTH_TOKEN) return res.sendStatus(503);
    if (!req.is('application/x-www-form-urlencoded')) return res.sendStatus(415);
    if (req.originalUrl !== publicUrl.pathname + publicUrl.search ||
        !twilio.validateRequest(config.TWILIO_AUTH_TOKEN,req.get('X-Twilio-Signature') || '',url,req.body || {}) ||
        req.body.AccountSid !== config.TWILIO_ACCOUNT_SID) return res.sendStatus(403);
    const {MessageSid,MessageStatus,ErrorCode} = req.body;
    if (!/^SM[0-9a-fA-F]{32}$/.test(MessageSid || '') ||
        !['accepted','queued','sending','sent','delivered','read','failed','undelivered'].includes(MessageStatus) ||
        (ErrorCode && !/^\d{1,9}$/.test(ErrorCode))) return res.sendStatus(400);
    try {
      await database.query(`INSERT INTO whatsapp_status_eventos (mensagem_id,estado,erro_codigo)
        VALUES ($1,$2,$3) ON CONFLICT (mensagem_id,estado) DO NOTHING`,[MessageSid,MessageStatus,ErrorCode ? Number(ErrorCode) : null]);
      return res.sendStatus(204);
    } catch {
      logger.error({event:'whatsapp.callback.failed',requestId:req.id},'Falha ao registrar callback');
      return res.sendStatus(503);
    }
  });
  return router;
}
