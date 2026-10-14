import twilio from 'twilio';
import { normalizeWhatsAppNumber } from './whatsappService.js';
import { alertContent } from './alertContent.js';

export const WELCOME = 'Olá! Bem-vindo ao LicitaMatch. Em breve você receberá informações sobre oportunidades de licitação.';
export function sandboxAllowed(config, number) {
  return (config.WHATSAPP_SANDBOX_NUMBERS || '').split(',').map(n => n.trim()).includes(number);
}
export function createWhatsAppService({ config, client, now = () => Date.now() }) {
  let provider = client;
  return { async sendMatchAlert(payload) {
    if (config.WHATSAPP_ENABLED !== 'true') throw new Error('WhatsApp desativado.');
    if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_WHATSAPP_FROM) throw new Error('Twilio não configurada.');
    const to = normalizeWhatsAppNumber(payload.to);
    if (!to) throw new Error('Número obrigatório.');
    const { item, score } = alertContent(payload);
    if (score < 67) throw new Error('Compatibilidade abaixo de 67%.');
    const city = String(payload.item?.municipio || 'Não informado').replace(/\s+/g,' ').slice(0,200);
    const uf = String(payload.item?.uf || 'N/D').slice(0,2);
    const variables = {'1':item.objeto,'2':item.unidadeGestora,'3':city,'4':uf,'5':String(score),'6':item.urlFonte || 'Link não disponível'};
    const message = { from:config.TWILIO_WHATSAPP_FROM,to:'whatsapp:'+to };
    if ((config.WHATSAPP_MODE || 'sandbox') === 'sandbox') {
      if (!sandboxAllowed(config,to)) throw new Error('Destinatário não autorizado no Sandbox.');
      const last = new Date(payload.lastInboundAt).getTime();
      if (!Number.isFinite(last) || last > now() || now()-last >= 86400000) throw new Error('Sandbox exige janela de atendimento ativa.');
      message.body = ['LicitaMatch — oportunidade','Objeto: '+variables['1'],'Órgão: '+variables['2'],
        'Município/UF: '+city+'/'+uf,'Compatibilidade: '+score+'%',variables['6']].join('\n');
    } else {
      if (config.WHATSAPP_PRODUCTION_READY !== 'true' || !/^HX[0-9a-fA-F]{32}$/.test(config.TWILIO_WHATSAPP_CONTENT_SID || ''))
        throw new Error('Produção exige remetente aprovado e template configurado.');
      message.contentSid = config.TWILIO_WHATSAPP_CONTENT_SID;
      message.contentVariables = JSON.stringify(variables);
    }
    provider ||= twilio(config.TWILIO_ACCOUNT_SID,config.TWILIO_AUTH_TOKEN,{timeout:15000,autoRetry:false});
    let result;
    try { result = await provider.messages.create(message); }
    catch (error) {
      const failure = new Error('Falha no envio Twilio.');
      failure.definitive = Number(error.status) >= 400 && Number(error.status) < 500;
      failure.providerCode = Number.isInteger(error.code) ? error.code : null;
      throw failure;
    }
    if (!/^SM[0-9a-fA-F]{32}$/.test(result?.sid || '')) throw new Error('Twilio não confirmou a aceitação.');
    return {accepted:true,messageId:result.sid};
  }};
}
