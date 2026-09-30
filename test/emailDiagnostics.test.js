import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTestEmail, diagnosticTransport, emailError, smtpTransport } from '../src/services/emailDiagnostics.js';
const config = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_USER: 'user@example.test', SMTP_PASSWORD: 'private-test-password', EMAIL_FROM: 'alerts@example.test' };
function capture() { const logs = []; return { logs, logger: { info: value => logs.push(value), error: value => logs.push(value) } }; }
test('test SMTP uses existing configuration, verifies before sending, logs messageId and closes', async () => {
  const { logs, logger } = capture(); const calls = [];
  const result = await sendTestEmail({ config, logger, to: 'test@example.test', transportFactory: received => {
    assert.equal(received, config);
    return { verify: async () => { calls.push('verify'); return true; }, sendMail: async payload => {
      calls.push('send'); assert.equal(payload.from, config.EMAIL_FROM); assert.equal(payload.to, 'test@example.test');
      return { accepted: [payload.to], messageId: 'smtp-123' };
    }, close: () => calls.push('close') };
  } });
  assert.deepEqual(calls, ['verify', 'send', 'close']); assert.equal(result.messageId, 'smtp-123');
  assert.equal(logs.find(x => x.event === 'email.verify.result').verified, true);
  assert.equal(logs.find(x => x.event === 'email.verify.result').connectionEstablished, true);
  assert.equal(logs.find(x => x.event === 'email.sent').messageId, 'smtp-123');
  assert.ok(!JSON.stringify(logs).includes(config.SMTP_PASSWORD));
});
test('verify failure blocks sendMail and preserves sanitized SMTP details', async () => {
  const { logs, logger } = capture();
  const error = Object.assign(new Error('Failure ' + config.SMTP_PASSWORD), { code: 'EAUTH', response: '535 ' + config.SMTP_PASSWORD, command: 'AUTH LOGIN' });
  const transport = { verify: async () => { throw error; }, sendMail: async () => assert.fail('must not send') };
  await assert.rejects(diagnosticTransport({ transport, config, logger }).sendMail({ to: 'test@example.test' }));
  const failure = logs.find(x => x.event === 'email.failed');
  assert.equal(failure.stage, 'verify'); assert.equal(failure.error.code, 'EAUTH'); assert.ok(failure.error.stack);
  assert.ok(!JSON.stringify(logs).includes(config.SMTP_PASSWORD));
  assert.ok(!JSON.stringify(emailError(new Error(Buffer.from(config.SMTP_PASSWORD).toString('base64')), config)).includes(Buffer.from(config.SMTP_PASSWORD).toString('base64')));
});
test('sendMail failures and missing configuration are diagnosed without successful logs', async () => {
  const { logs, logger } = capture(); let closed = false;
  await assert.rejects(sendTestEmail({ config, logger, to: 'test@example.test', transportFactory: () => ({ verify: async () => true,
    sendMail: async () => { throw new Error('connection lost'); }, close: () => { closed = true; } }) }));
  assert.ok(closed); assert.equal(logs.find(x => x.event === 'email.failed').stage, 'sendMail');
  assert.ok(!logs.some(x => x.event === 'email.sent'));
  await assert.rejects(sendTestEmail({ config: {}, logger, to: 'test@example.test', transportFactory: () => assert.fail('missing configuration') }));
});

test('Brevo transport supports STARTTLS 587 and explicit or inferred TLS 465', () => {
  for (const [port, flag, expected] of [[587, 'false', false], [465, 'true', true], [587, undefined, false], [465, undefined, true], [2525, 'true', true], [465, 'false', false]]) {
    const transport = smtpTransport({ ...config, SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: port, SMTP_SECURE: flag });
    try {
      assert.equal(transport.options.host, 'smtp-relay.brevo.com');
      assert.equal(transport.options.port, port);
      assert.equal(transport.options.secure, expected);
      assert.equal(transport.options.requireTLS, true);
      for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) assert.equal(transport.options[key], 30000);
      assert.deepEqual(transport.options.auth, { user: config.SMTP_USER, pass: config.SMTP_PASSWORD });
    } finally { transport.close(); }
  }
});
test('CONN timeout explicitly records connection not established and blocks sendMail', async () => {
  const { logs, logger } = capture();
  const transport = { verify: async () => { throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' }); }, sendMail: async () => assert.fail('must not send') };
  await assert.rejects(diagnosticTransport({ transport, config, logger }).sendMail({ to: 'test@example.test' }));
  const failure = logs.find(x => x.event === 'email.failed');
  assert.equal(failure.connectionEstablished, false);
  assert.equal(failure.error.code, 'ETIMEDOUT');
  assert.equal(failure.error.command, 'CONN');
  assert.ok(!logs.some(x => x.event === 'email.sent'));
});
