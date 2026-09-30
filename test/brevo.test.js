import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { parseEnv } from '../src/config/env.js';
import { sendTestEmail, emailTransport, diagnosticTransport } from '../src/services/emailDiagnostics.js';
import { createEmailService } from '../src/services/emailService.js';
import { emailProvider } from '../src/config/email.js';
const input = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', SESSION_SECRET: 'automated-tests-only-'.repeat(4), EMAIL_FROM: 'alerts@example.test', BREVO_API_KEY: 'synthetic-private-brevo-key', EMAIL_PROVIDER: 'smtp' };
const config = parseEnv(input);
function capture() { const logs = []; return { logs, logger: { info: data => logs.push(data), error: data => logs.push(data) } }; }
test('Brevo key takes precedence and enables email without SMTP credentials', () => {
  for (const provider of ['smtp', 'resend', 'brevo_api']) {
    const parsed = parseEnv({ ...input, EMAIL_PROVIDER: provider });
    assert.equal(parsed.EMAIL_PROVIDER, 'brevo_api'); assert.equal(parsed.EMAIL_ENABLED, 'true');
    assert.equal(parsed.BREVO_API_KEY, input.BREVO_API_KEY);
  }
  assert.equal(parseEnv({ ...input, EMAIL_ENABLED: 'false' }).EMAIL_ENABLED, 'false');
  assert.equal(parseEnv({ ...input, BREVO_API_KEY: '' }).EMAIL_PROVIDER, 'smtp');
  assert.throws(() => parseEnv({ ...input, BREVO_API_KEY: undefined, EMAIL_PROVIDER: 'brevo_api', EMAIL_ENABLED: 'true' }), /BREVO_API_KEY/);
});
test('test button and match alerts use Brevo HTTP without Nodemailer or verify', async () => {
  const { logs, logger } = capture(); const payloads = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => assert.fail('Nodemailer must not be used');
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['api-key'], config.BREVO_API_KEY);
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body); payloads.push(body);
    assert.deepEqual(body.sender, { email: config.EMAIL_FROM });
    assert.deepEqual(body.to, [{ email: 'recipient@example.test' }]);
    assert.ok(body.htmlContent); assert.ok(body.textContent);
    return new Response(JSON.stringify({ messageId: 'brevo-123' }), { status: 201 });
  };
  try {
    await sendTestEmail({ config, logger, to: 'recipient@example.test', fetchImpl });
    const transport = emailTransport(config, { fetchImpl });
    transport.verify = () => assert.fail('verify must not be called');
    await createEmailService({ from: config.EMAIL_FROM, transport: diagnosticTransport({ transport, config, logger, provider: emailProvider(config) }) })
      .sendMatchAlert({ to: 'recipient@example.test', score: 80 });
    assert.equal(payloads.length, 2);
    assert.equal(logs.filter(x => x.event === 'email.api.success' && x.provider === 'brevo_api' && x.messageId === 'brevo-123').length, 2);
    assert.ok(!logs.some(x => x.event.startsWith('email.verify')));
    assert.ok(!JSON.stringify(logs).includes(config.BREVO_API_KEY));
  } finally { nodemailer.createTransport = original; }
});
test('Brevo HTTP errors, malformed responses and network timeouts are logged without leaking key or SMTP fallback', async () => {
  const cases = [
    async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Invalid key ' + config.BREVO_API_KEY }), { status: 401 }),
    async () => new Response('{}', { status: 429 }),
    async () => new Response('invalid', { status: 500 }),
    async () => new Response('{}', { status: 201 }),
    async () => { throw Object.assign(new Error('Network ' + config.BREVO_API_KEY), { code: 'ETIMEDOUT' }); }
  ];
  for (const fetchImpl of cases) {
    const { logs, logger } = capture();
    await assert.rejects(sendTestEmail({ config, logger, to: 'recipient@example.test', fetchImpl, transportFactory: () => assert.fail('No SMTP fallback') }));
    assert.ok(logs.some(x => x.event === 'email.api.failed' && x.provider === 'brevo_api'));
    assert.ok(!logs.some(x => x.event === 'email.api.success'));
    assert.ok(!JSON.stringify(logs).includes(config.BREVO_API_KEY));
  }
});
