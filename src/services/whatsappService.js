import { alertContent } from './alertContent.js';

export function normalizeWhatsAppNumber(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]*$/.test(value) || value.length>30) throw new Error('Informe um celular válido com DDD.');
  const digits = value.replace(/\D/g,'');
  if (!digits) return '';
  const number = digits.length===11 ? '+55'+digits : '+'+digits;
  if (!/^\+55[1-9]\d9\d{8}$/.test(number)) throw new Error('Informe um celular brasileiro com DDD e nove dígitos.');
  return number;
}

export function createWhatsAppService({config,fetchImpl = globalThis.fetch}) {
  return { async sendMatchAlert(payload) {
    const to = normalizeWhatsAppNumber(payload.to);
    if (!to) throw new Error('Número de WhatsApp obrigatório.');
    if (!config.WHATSAPP_ACCESS_TOKEN || !/^\d+$/.test(config.WHATSAPP_PHONE_NUMBER_ID || '') ||
        !/^v\d+\.0$/.test(config.WHATSAPP_API_VERSION || '') || !/^[a-z0-9_]+$/.test(config.WHATSAPP_TEMPLATE_NAME || '')) {
      throw new Error('WhatsApp não configurado.');
    }
    const {customer,interestName,score,item} = alertContent(payload);
    const parameters = [customer,interestName,String(score),item.modalidade,item.unidadeGestora,item.objeto].map(text=>({type:'text',text}));
    let response;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:to.slice(1),type:'template',
          template:{name:config.WHATSAPP_TEMPLATE_NAME,language:{code:config.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR'},components:[{type:'body',parameters}]}})
      });
    } catch { throw new Error('Não foi possível conectar ao WhatsApp.'); }
    // Provider errors can contain phone numbers, tokens and message text. Do not log them.
    if (!response.ok) throw new Error(`WhatsApp recusou a solicitação (HTTP ${Number(response.status)||500}).`);
    let result;
    try { result = await response.json(); } catch { throw new Error('Resposta inválida do WhatsApp.'); }
    const messageId = result?.messages?.[0]?.id;
    if (result.error || typeof messageId!=='string' || !messageId || messageId.length>512) throw new Error('WhatsApp não confirmou a aceitação da mensagem.');
    return {accepted:true,messageId};
  } };
}
