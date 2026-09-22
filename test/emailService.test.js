import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailService } from '../src/services/emailService.js';

test('createEmailService envia alerta de oportunidade com payload válido', async () => {
  const calls = [];
  const service = createEmailService({
    from: 'alertas@licitamatch.local',
    transport: {
      sendMail: async payload => {
        calls.push(payload);
        return { messageId: 'mail-123' };
      }
    }
  });

  const result = await service.sendMatchAlert({
    to: 'gestor@empresa.test',
    customer: 'Empresa Teste',
    item: { objeto: 'Compra de computadores', modalidade: 'Pregão Eletrônico', unidadeGestora: 'Secretaria da Fazenda' },
    score: 92,
    interestName: 'Infraestrutura'
  });

  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'gestor@empresa.test');
  assert.match(calls[0].subject, /Infraestrutura/i);
  assert.match(calls[0].html, /92%/i);
});

test('createEmailService rejeita e-mail inválido ou sem transport', async () => {
  const service = createEmailService({ transport: null });
  await assert.rejects(() => service.sendMatchAlert({
    to: 'email-invalido',
    item: { objeto: 'Compra', modalidade: 'Pregão', unidadeGestora: 'Orgão' },
    score: 60,
    interestName: 'Equipamentos'
  }), /e-mail|transport/i);

  const configured = createEmailService({ transport: { sendMail: async () => ({ accepted: true }) } });
  await assert.rejects(() => configured.sendMatchAlert({
    to: '',
    item: { objeto: 'Compra', modalidade: 'Pregão', unidadeGestora: 'Orgão' },
    score: 60,
    interestName: 'Equipamentos'
  }), /destinatário/i);
});
