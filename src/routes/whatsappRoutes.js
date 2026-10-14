import { whatsappEligibilitySql } from '../services/whatsappAlertsService.js';
import { Router } from 'express';
import twilio from 'twilio';
import { normalizeWhatsAppNumber } from '../services/whatsappService.js';
import { sandboxAllowed, WELCOME } from '../services/twilioWhatsAppService.js';

export function whatsappRoutes({ config, database, logger }) {
  const router = Router();
  router.post('/api/whatsapp/webhook', async (req,res) => {
    const empty = () => res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
    if (!config.TWILIO_AUTH_TOKEN) return res.sendStatus(503);
    if (!req.is('application/x-www-form-urlencoded')) return res.sendStatus(415);
    // Use the configured external URL, including its exact query. Never trust proxy/Host headers.
    const url = config.WHATSAPP_WEBHOOK_URL || 'https://licitamatch.online/api/whatsapp/webhook';
    const publicUrl = new URL(url);
    if (req.originalUrl !== publicUrl.pathname + publicUrl.search) return res.sendStatus(403);
    if (!twilio.validateRequest(config.TWILIO_AUTH_TOKEN,req.get('X-Twilio-Signature') || '',url,req.body || {})) return res.sendStatus(403);
    if (req.body.AccountSid !== config.TWILIO_ACCOUNT_SID || req.body.To !== config.TWILIO_WHATSAPP_FROM) return res.sendStatus(403);
    if (!/^SM[0-9a-fA-F]{32}$/.test(req.body.MessageSid || '') || !/^whatsapp:\+/.test(req.body.From || '')) return res.sendStatus(400);
    let number;
    try { number = normalizeWhatsAppNumber(req.body.From.slice(9)); } catch { return res.sendStatus(400); }
    if (config.WHATSAPP_ENABLED !== 'true') return empty();
    if ((config.WHATSAPP_MODE || 'sandbox') === 'sandbox' && !sandboxAllowed(config,number)) return empty();
    try {
      const eligible = await database.query("SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE u.whatsapp_numero=$1 AND "+whatsappEligibilitySql+" LIMIT 1",[number]);
      if (!eligible.rows.length) return empty();
      const record = await database.query("INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING mensagem_id",[req.body.MessageSid,number]);
      const response = new twilio.twiml.MessagingResponse();
      if (record.rows.length) response.message(WELCOME);
      return res.type('text/xml').send(response.toString());
    } catch {
      logger.error({event:'whatsapp.webhook.failed'},'Falha ao registrar mensagem WhatsApp');
      return res.sendStatus(503);
    }
  });
  return router;
}
