import { alertContent } from './alertContent.js';

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
    async sendMatchAlert({ to, customer, item, score, interestName }) {
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

      const result = await transport.sendMail(payload);
      return { accepted: true, ...result, message: payload };
    }
  };
}
