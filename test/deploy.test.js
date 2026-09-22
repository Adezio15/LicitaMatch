import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { safeError } from '../src/utils/safeError.js';
import { parseEnv } from '../src/config/env.js';
import { checkDatabase } from '../src/services/databaseCheckService.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';

test('diagnóstico preserva causa e stack sem URLs, credenciais ou tokens', () => {
  const env = {
    DATABASE_URL: 'postgresql://neon_owner:p%40ss-secret@db.example/neondb?sslmode=verify-full',
    DATABASE_DIRECT_URL: 'postgresql://direct_owner:direct-pass@direct.example/neondb',
    SESSION_SECRET: 'session-value-'.repeat(5),
    SMTP_PASSWORD: 'smtp-private',
    API_TOKEN: 'private-token'
  };
  const error = new Error(`password authentication failed for user "neon_owner" ${env.DATABASE_URL} ${env.DATABASE_DIRECT_URL} p@ss-secret p%40ss-secret direct-pass ${env.SESSION_SECRET} smtp-private private-token password="unknown value" Bearer unseen-token postgresql://other:other-pass@other/db`);
  error.code = '28P01';
  error.detail = 'never serialize arbitrary error properties';
  const result = safeError(error, env);
  assert.equal(result.name, 'Error');
  assert.equal(result.code, '28P01');
  assert.match(result.message, /password authentication failed/);
  assert.match(result.stack, /deploy.test.js/);
  const output = JSON.stringify(result);
  for (const value of [...Object.values(env), 'neon_owner', 'direct_owner', 'p@ss-secret', 'p%40ss-secret', 'direct-pass', 'unknown value', 'unseen-token', 'other-pass', 'db.example', error.detail]) {
    assert.ok(!output.includes(value), `Leaked sensitive test value: ${value}`);
  }
});

test('DATABASE_DIRECT_URL é opcional, mas validada quando fornecida', () => {
  const env = { DATABASE_URL: 'postgresql://user:pass@db/test', SESSION_SECRET: 'test-secret-'.repeat(5) };
  assert.equal(parseEnv(env).DATABASE_DIRECT_URL, undefined);
  assert.equal(parseEnv({ ...env, DATABASE_DIRECT_URL: '' }).DATABASE_DIRECT_URL, undefined);
  assert.throws(() => parseEnv({ ...env, DATABASE_DIRECT_URL: 'invalid-private-value' }), error => {
    assert.deepEqual(error.fields, ['DATABASE_DIRECT_URL']);
    assert.ok(!JSON.stringify(safeError(error)).includes('invalid-private-value'));
    return true;
  });
});

test('startup e diagnóstico retornam erro útil de ambiente sem segredos', () => {
  for (const script of ['src/server.js', 'scripts/check-deploy.js', 'scripts/migrate.js']) {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'invalid-private-url', DATABASE_DIRECT_URL: '', SESSION_SECRET: 'short-private-secret', NODE_ENV: 'production', LOCAL_DATABASE: 'false' }
    });
    assert.equal(result.status, 1);
    const log = result.stdout.trim().split('\n').map(line => JSON.parse(line)).find(row => row.error);
    assert.equal(log.stage, 'environment');
    assert.equal(log.error.code, 'INVALID_ENV');
    assert.match(log.error.message, /DATABASE_URL/);
    assert.ok(log.error.stack);
    assert.ok(!(result.stdout + result.stderr).includes('invalid-private-url'));
    assert.ok(!(result.stdout + result.stderr).includes('short-private-secret'));
  }
});

test('verificação somente leitura identifica migrations e tabelas ausentes e checksums alterados', async () => {
  const db = new PGlite();
  const readonly = { query(sql, params) {
    assert.match(sql, /^SELECT /);
    return db.query(sql, params);
  } };
  const migrationClient = { query(sql, params) {
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('CREATE TABLE')) return db.exec(sql);
    return db.query(sql, params);
  } };
  try {
    await assert.rejects(checkDatabase(readonly), error => error.code === 'DATABASE_SCHEMA_MISMATCH' && error.message.includes('sessoes'));
    const migrations = await readMigrations();
    await runMigrations(migrationClient, migrations);
    assert.deepEqual(await checkDatabase(readonly), { connection: 'ok', tables: 7, migrations: 4 });
    await db.query("UPDATE schema_migrations SET checksum='changed' WHERE name=$1", [migrations[0].name]);
    await assert.rejects(checkDatabase(readonly), /checksums alterados: 001_foundation.sql/);
    await db.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [migrations[0].checksum, migrations[0].name]);
    await db.query('DROP TABLE sessoes'); // Isolated in-memory test database only.
    await assert.rejects(checkDatabase(readonly), /Tabelas ausentes: sessoes/);
  } finally { await db.close(); }
});
