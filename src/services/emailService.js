import { alertContent } from './alertContent.js';

export function createResendTransport({ apiKey, fetchImpl = globalThis.fetch }) {
  return { async sendMail(payload) {
    if (!apiKey) throw new Error('Resend não configurado.');
    let response;
    try {
      response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, to: [payload.to] })
      });
    } catch { throw new Error('Não foi possível conectar ao provedor de e-mail HTTPS.'); }
    if (!response.ok) throw new Error(`Provedor de e-mail recusou a solicitação (HTTP ${Number(response.status) || 500}).`);
    let result;
    try { result = await response.json(); } catch { throw new Error('Resposta inválida do provedor de e-mail.'); }
    if (result.error || typeof result.id !== 'string' || !result.id) throw new Error('Provedor de e-mail não confirmou a aceitação.');
    return { accepted: [payload.to], messageId: result.id };
  } };
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function formatText(item = {}, score, interestName, customer) {
  return [
    `Olá, ${customer}.`,
    ``,
    `Uma oportunidade relevante foi identificada para o interesse "${interestName}".`,
    ``,
    `- Pontuação: ${score}%`,
    `- Modalidade: ${item?.modalidade || 'N/D'}`,
    `- Unidade gestora: ${item?.unidadeGestora || 'Não informado'}`,
    `- Objeto: ${item?.objeto || 'Não informado'}`,
    ``,
    `Acesse o painel do LicitaMatch para revisar a oportunidade.`
  ].join('\n');
}

export function createEmailService({ transport, from = 'alertas@licitamatch.local' } = {}) {
  return {
    async sendMatchAlert({ to, customer, item, score, interestName, context }) {
      if (!transport || typeof transport.sendMail !== 'function') {
        throw new Error('Transport de e-mail não configurado.');
      }
      if (!to || !isValidEmail(to)) {
        throw new Error('Destinatário de e-mail inválido.');
      }
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error('Pontuação do alerta deve ser numérica.');
      }

      if (!isValidEmail(from) || /[\r\n]/.test(String(interestName || ''))) throw new Error('Remetente ou assunto inválido.');
      ({customer,item,score,interestName} = alertContent({customer,item,score,interestName}));
      const subject = `${interestName || 'Oportunidade'} · match ${score}%`;
      const text = formatText(item, score, interestName || 'Oportunidade',customer);
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#112a39;">
          <h2 style="margin:0 0 12px;">Alerta de oportunidade</h2>
          <p><strong>${escapeHtml(customer || 'Cliente')}</strong>, há uma oportunidade relevante para o interesse "${escapeHtml(interestName || 'Oportunidade')}".</p>
          <p><strong>Pontuação:</strong> ${score}%</p>
          <p><strong>Objeto:</strong> ${escapeHtml(item?.objeto || 'Não informado')}</p>
          <p><strong>Modalidade:</strong> ${escapeHtml(item?.modalidade || 'N/D')}</p>
          <p><strong>Unidade gestora:</strong> ${escapeHtml(item?.unidadeGestora || 'Não informado')}</p>
        </div>
      `;

      const payload = {
        from,
        to: String(to).trim(),
        subject,
        text,
        html
      };

      const result = await transport.sendMail(payload, context);
      if (result?.accepted === false || (Array.isArray(result?.accepted) && !result.accepted.length) || result?.rejected?.length) {
        throw new Error('O servidor SMTP não aceitou o destinatário.');
      }
      return { ...result, accepted: true, message: payload };
    }
  };
}
