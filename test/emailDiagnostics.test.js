import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTestEmail, diagnosticTransport, emailError } from '../src/services/emailDiagnostics.js';
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
