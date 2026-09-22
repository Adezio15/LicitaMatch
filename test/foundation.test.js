import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { parseEnv } from '../src/config/env.js';
import { formatDateTime } from '../src/utils/date.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/utils/logger.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';

const config = parseEnv({ DATABASE_URL: 'postgresql://test:test@localhost/test', NODE_ENV: 'test', SESSION_SECRET: 'test-only-secret-'.repeat(5) });
const logger = createLogger('silent');

test('ambiente exige banco e rejeita porta/timezone inválidos sem expor segredos', () => {
  assert.throws(() => parseEnv({}), /DATABASE_URL/);
  assert.throws(() => parseEnv({ DATABASE_URL: 'senha-secreta', SESSION_SECRET: 'segredo-curto' }), error => {
    assert.equal(error.code, 'INVALID_ENV');
    assert.deepEqual(error.fields, ['DATABASE_URL', 'SESSION_SECRET']);
    assert.ok(!JSON.stringify(error).includes('senha-secreta'));
    assert.ok(!JSON.stringify(error).includes('segredo-curto'));
    return true;
  });
  assert.throws(() => parseEnv({ DATABASE_URL: 'senha-secreta' }), error => !error.message.includes('senha-secreta'));
  assert.throws(() => parseEnv({ ...config, PORT: 'abc' }), /PORT/);
  assert.throws(() => parseEnv({ ...config, APP_TIMEZONE: 'UTC' }), /APP_TIMEZONE/);
  assert.throws(() => parseEnv({ ...config, SESSION_SECRET: 'curto' }), /SESSION_SECRET/);
  assert.equal(parseEnv({ ...config, DATABASE_DIRECT_URL: '' }).DATABASE_DIRECT_URL, undefined);
});

test('apresentação usa Fortaleza e cruza meia-noite corretamente', () => {
  assert.equal(formatDateTime('2026-09-20T01:30:00Z'), '19/09/2026, 22:30');
  assert.equal(formatDateTime('2026-09-20T10:30:00-03:00'), '20/09/2026, 10:30');
  assert.throws(() => formatDateTime('2026-09-20T10:30:00'), /offset/);
});

test('HTTP: saúde, proteção, 404 e falha de banco sem vazamento', async () => {
  const app = createApp({ config, logger, database: { query: async () => ({ rows: [] }) } });
  const live = await request(app).get('/health/live').expect(200);
  assert.equal(live.body.status, 'ok');
  assert.equal(live.headers['x-powered-by'], undefined);
  assert.ok(live.headers['content-security-policy']);
  await request(app).get('/health/ready').expect(200);
  await request(app).get('/nao-existe').expect(404);
  const malformed = await request(app).post('/').set('Content-Type', 'application/json').send('{').expect(400);
  assert.equal(malformed.body.error, 'Requisição inválida');
  const unavailable = createApp({ config, logger, database: { query: async () => { throw new Error('postgres://secret'); } } });
  const response = await request(unavailable).get('/health/ready').expect(503);
  assert.ok(!response.text.includes('secret'));
});

test('migrations: SQL PostgreSQL, constraints, idempotência, checksum e rollback', async () => {
  const db = new PGlite();
  // PGlite é single-process e não implementa advisory locks. Só esse comando é substituído.
  const client = { query: async (sql, params) => {
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('CREATE TABLE')) return db.exec(sql);
    return db.query(sql, params);
  } };
  try {
    const migrations = await readMigrations();
    assert.deepEqual(await runMigrations(client, migrations), migrations.map(migration => migration.name));
    assert.deepEqual(await runMigrations(client, migrations), []);
    await assert.rejects(runMigrations(client, migrations.map((migration, i) => i === 0 ? { ...migration, checksum: 'alterado' } : migration)), /alterada/);
    await db.query("INSERT INTO empresas (razao_social, cnpj, email) VALUES ('Exemplo', '12345678000199', 'empresa@example.test')");
    await assert.rejects(db.query("INSERT INTO empresas (razao_social, cnpj, email) VALUES ('Outra', '12345678000199', 'outra@example.test')"), /unique/);
    const hash = '$2b$12$' + 'a'.repeat(53);
    await db.query('INSERT INTO usuarios (empresa_id, nome, email, senha_hash) VALUES ($1,$2,$3,$4)', [1, 'Teste', 'USER@example.test', hash]);
    await assert.rejects(db.query('INSERT INTO usuarios (empresa_id, nome, email, senha_hash) VALUES ($1,$2,$3,$4)', [1, 'Teste', 'user@example.test', hash]), /unique/);
    await assert.rejects(db.query('INSERT INTO usuarios (empresa_id, nome, email, senha_hash) VALUES ($1,$2,$3,$4)', [999, 'Teste', 'other@example.test', hash]), /foreign key/);
    await assert.rejects(db.query('INSERT INTO usuarios (empresa_id, nome, email, senha_hash) VALUES ($1,$2,$3,$4)', [1, 'Teste', 'other@example.test', 'texto-simples']), /check constraint/);
    await assert.rejects(runMigrations(client, [...migrations,
      { name: '002_test.sql', checksum: 'a', sql: 'CREATE TABLE rollback_probe (id int)' },
      { name: '003_test.sql', checksum: 'b', sql: 'INVALID SQL' }
    ]));
    const { rows } = await db.query("SELECT to_regclass('public.rollback_probe') AS table_name");
    assert.equal(rows[0].table_name, null);
    const columns = await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='usuarios' AND column_name='created_at'");
    assert.equal(columns.rows[0].data_type, 'timestamp with time zone');
  } finally { await db.close(); }
});
