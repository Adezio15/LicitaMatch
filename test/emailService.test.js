import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailService, createResendTransport } from '../src/services/emailService.js';

test('e-mail HTTPS envia conteúdo e exige confirmação sem expor erros do provedor', async () => {
  const transport = createResendTransport({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer synthetic');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ['a@example.test']);
    assert.ok(body.html);
    assert.ok(body.text);
    return new Response(JSON.stringify({ id: 'email-123' }));
  } });
  const payload = { to: 'a@example.test', score: 80 };
  const result = await createEmailService({ transport }).sendMatchAlert(payload);
  assert.equal(result.messageId, 'email-123');
  assert.equal(result.accepted, true);
  for (const response of [new Response('{}'), new Response('private-token', { status: 401 }), new Response('invalid')]) {
    const failing = createEmailService({ transport: createResendTransport({ apiKey: 'synthetic', fetchImpl: async () => response }) });
    await assert.rejects(failing.sendMatchAlert(payload), error => !error.message.includes('private-token'));
  }
});

test('SMTP sem destinatário aceito não confirma envio', async () => {
  for (const result of [{ accepted: [], rejected: ['a@example.test'] }, { accepted: false }]) {
    const service = createEmailService({ transport: { sendMail: async () => result } });
    await assert.rejects(service.sendMatchAlert({ to: 'a@example.test', score: 80 }), /SMTP/);
  }
});

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
