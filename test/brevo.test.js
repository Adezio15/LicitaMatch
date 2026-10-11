import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { parseEnv } from '../src/config/env.js';
import { sendEmail, sendTestEmail } from '../src/services/emailDiagnostics.js';
import { createEmailService } from '../src/services/emailService.js';
import { createOperationsService } from '../src/services/operationsService.js';
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
    await createEmailService({ from: config.EMAIL_FROM, transport: { sendMail: payload => sendEmail({ config, logger, payload, fetchImpl }) } })
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

test('automatic worker sends at 67 via the same Brevo function and logs context and API outcomes', async () => {
  const { logs, logger } = capture();
  const originalFetch = globalThis.fetch;
  const payloads = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify(fail ? { message: 'Rejected' } : { messageId: 'automatic-67' }), { status: fail ? 400 : 201 });
  };
  const row = { id: 1, email: 'recipient@example.test', razao_social: 'Empresa', titulo: 'Interesse', score: 67, objeto: 'Compra' };
  const query = async (sql, params) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('SELECT * FROM tarefas')) return { rows: [{}] };
    if (sql.includes('SELECT DISTINCT ON (a.id)') || sql.includes('INSERT INTO alertas_empresa_email')) {
      assert.equal(params[0], 67, 'email threshold must override configured 80');
      return { rows: sql.includes('SELECT DISTINCT ON (a.id)') ? [row] : [] };
    }
    if (sql.includes('RETURNING id')) return { rows: [{ id: row.id }] };
    return { rows: [] };
  };
  const worker = createOperationsService({ config: { ...config, ALERT_MIN_SCORE: 80 }, logger,
    database: { connect: async () => ({ query, release() {} }) }, registry: { listSources: () => [] } });
  try {
    await worker.sendTestEmail(row.email);
    await worker.runOnce();
    assert.equal(payloads.length, 2);
    assert.match(payloads[1].subject, /67%/);
    const expected = { empresa: row.razao_social, interesse: row.titulo, score: 67, destinatario: row.email };
    for (const event of ['automatic.alert.start', 'automatic.alert.success', 'email.api.success']) {
      assert.ok(logs.some(log => log.event === event && Object.entries(expected).every(([key, value]) => log[key] === value)));
    }
    fail = true;
    await worker.runOnce();
    assert.ok(logs.some(log => log.event === 'email.api.failed' && log.empresa === row.razao_social));
    assert.ok(!logs.some(log => log.event?.startsWith('email.verify')));
  } finally { await worker.stop(); globalThis.fetch = originalFetch; }
});


test('persisted matches trigger Brevo immediately, cross 67, log skips and deduplicate per company', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readMigrations } = await import('../src/services/migrationService.js');
  const { persistPncpItems } = await import('../src/services/pncpPersistenceService.js');
  const db = new PGlite();
  const { logs, logger } = capture();
  const originalFetch = globalThis.fetch;
  const payloads = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify(fail ? {} : { messageId: 'saved-match' }), { status: fail ? 400 : 201 });
  };
  const database = { query: (sql, values) => db.query(sql, values) };
  const worker = createOperationsService({ database, config, logger, registry: { listSources: () => [] } });
  const item = { id: 'saved-match', dataAbertura: '2026-10-10T12:00:00Z', objeto: 'Compra de notebooks', modalidade: 'Pregão Eletrônico', unidadeGestora: 'Secretaria' };
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
  // Existing feature scenarios exercise a fully entitled company; plan boundaries have dedicated tests.
  await db.exec("ALTER TABLE empresas ALTER COLUMN plano SET DEFAULT 'premium'");
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email) VALUES
      ('Primeira','11222333000181','first@example.test'),('Segunda','11444777000161','second@example.test');
      INSERT INTO interesses (empresa_id,titulo,palavras) VALUES
      (1,'Computadores',ARRAY['notebook','extra']), (2,'Computadores',ARRAY['notebook','compra','extra']);`);
    await persistPncpItems(database, [item]);
    await worker.correlate(1);
    assert.equal(payloads.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM matches WHERE empresa_id=1')).rows[0].n, 0);
    assert.ok(!logs.some(x => x.event === 'match.created' && x.score === 50));
    await db.exec("UPDATE interesses SET palavras=ARRAY['notebook','compra','extra'] WHERE empresa_id=1");
    await worker.correlate(1);
    assert.equal(payloads.length, 1, 'first qualifying score sends before correlation returns');
    assert.equal(payloads[0].to[0].email, 'first@example.test');
    const created = logs.findIndex(x => x.event === 'match.created' && x.score === 67);
    const started = logs.findIndex(x => x.event === 'automatic.alert.start');
    assert.ok(created >= 0 && started > created);
    for (const event of ['automatic.alert.success', 'email.api.success']) assert.ok(logs.some(x => x.event === event));
    await db.exec("INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Duplicado',ARRAY['notebook'])");
    await Promise.all([worker.correlate(1), worker.correlate(1)]);
    assert.equal(payloads.length, 1);
    assert.ok(logs.some(x => x.event === 'automatic.alert.skipped' && x.reason === 'ja_enviado'));
    await worker.correlate(2);
    assert.equal(payloads.length, 2, 'the same opportunity is sent once to each company');
    assert.equal(payloads[1].to[0].email, 'second@example.test');
    fail = true;
    await persistPncpItems(database, [{ ...item, id: 'failed-match', objeto: 'Compra de notebooks novos', unidadeGestora: 'Outra secretaria' }]);
    await worker.correlate(2);
    await worker.correlate(2);
    assert.equal(payloads.length, 3, 'failed or uncertain delivery is not sent again');
    assert.ok(logs.some(x => x.event === 'email.api.failed'));
    assert.equal((await db.query("SELECT status FROM alertas_empresa_email WHERE empresa_id=2 ORDER BY id DESC LIMIT 1")).rows[0].status, 'falhou');
  } finally {
    globalThis.fetch = originalFetch;
    await worker.stop();
    await db.close();
  }
});
