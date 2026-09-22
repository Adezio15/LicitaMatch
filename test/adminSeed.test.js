import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { createAdmin, parseAdminSeed } from '../src/services/adminSeedService.js';
import { accountService } from '../src/services/accountService.js';

const env = { SEED_USER_ROLE: 'admin', SEED_USER_EMAIL: ' ADMIN@example.test ', SEED_USER_PASSWORD: 'Senha-segura-teste-2026!' };

test('valida perfil, email, senha e argumentos sem expor entradas', () => {
  assert.equal(parseAdminSeed(env).email, 'admin@example.test');
  for (const change of [{ SEED_USER_ROLE: 'gestor' }, { SEED_USER_EMAIL: 'invalid' }, { SEED_USER_PASSWORD: 'short' }, { SEED_USER_PASSWORD: 'á'.repeat(37) }, { SEED_COMPANY_ID: '1 OR 1=1' }]) {
    assert.throws(() => parseAdminSeed({ ...env, ...change }));
  }
  assert.throws(() => parseAdminSeed(env, ['--unknown']));
});

test('cria admin compatível com login, preserva duplicado e troca senha invalidando sessões', async () => {
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    // PGlite is single connection; advisory locks are verified by PostgreSQL in production.
    const client = { query: (sql, values) => sql.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] }) : db.query(sql, values) };
    const opts = parseAdminSeed(env);
    await assert.rejects(createAdmin(client, opts), /SEED_COMPANY_ID/);
    const company = (await db.query("INSERT INTO empresas (razao_social, cnpj, email) VALUES ('Empresa', '11222333000181', 'empresa@example.test') RETURNING id")).rows[0];
    opts.companyId = String(company.id);
    await assert.rejects(createAdmin(client, { ...opts, companyId: '999' }), /ativos/);
    // A failure even after INSERT must roll back the entire operation.
    const failingClient = { query: async (sql, values) => {
      const result = await client.query(sql, values);
      if (sql.includes('INSERT INTO usuarios')) throw new Error('simulated write failure');
      return result;
    } };
    await assert.rejects(createAdmin(failingClient, opts), /simulated write failure/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n, 0);
    assert.equal(await createAdmin(client, opts), 'created');
    await db.query('UPDATE usuarios SET email=$1', [' ADMIN@example.test ']);
    const service = accountService(client);
    const user = await service.login({ email: opts.email, senha: opts.password });
    assert.equal(user.tipo, 'admin');
    assert.equal(bcrypt.getRounds(user.senha_hash), 12);
    assert.notEqual(user.senha_hash, opts.password);
    assert.equal(await createAdmin(client, { ...opts, password: 'Outra-senha-segura-2026' }), 'exists');
    assert.equal((await service.login({ email: opts.email, senha: opts.password })).senha_hash, user.senha_hash);
    const newPassword = 'Nova-senha-segura-2026';
    assert.equal(await createAdmin(client, { ...opts, companyId: undefined, password: newPassword, updatePassword: true }), 'updated');
    const updated = await service.login({ email: opts.email, senha: newPassword });
    assert.equal(updated.auth_version, user.auth_version + 1);
    await assert.rejects(service.login({ email: opts.email, senha: opts.password }));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n, 1);
    await assert.rejects(createAdmin(client, { ...opts, companyId: '999' }), /outra empresa/);
    await assert.rejects(createAdmin(client, { ...opts, email: 'absent@example.test', updatePassword: true }), /não encontrado/);
    await db.query("UPDATE usuarios SET tipo='gestor'");
    await assert.rejects(createAdmin(client, { ...opts, updatePassword: true }), /não administrador/);
    assert.equal((await db.query('SELECT senha_hash FROM usuarios')).rows[0].senha_hash, updated.senha_hash);
    await db.query("UPDATE usuarios SET tipo='admin', ativo=false");
    await assert.rejects(createAdmin(client, { ...opts, updatePassword: true }), /ativos/);
    await db.query("UPDATE empresas SET status='suspenso'");
    await assert.rejects(createAdmin(client, { ...opts, email: 'second@example.test' }), /ativos/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('CLI não registra senha, URL ou erros brutos e prioriza URL direta', () => {
  const secret = 'Segredo-nao-imprimir-2026';
  const result = spawnSync(process.execPath, ['scripts/create-admin.js'], { encoding: 'utf8', env: {
    ...process.env, NODE_ENV: 'production', ...env, SEED_USER_PASSWORD: secret,
    DATABASE_DIRECT_URL: `invalid-${secret}`, DATABASE_URL: 'postgresql://localhost/test'
  } });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /URL PostgreSQL válida/);
  assert.ok(!(result.stdout + result.stderr).includes(secret));
  const invalid = spawnSync(process.execPath, ['scripts/create-admin.js'], { encoding: 'utf8', env: {
    ...process.env, NODE_ENV: 'production', ...env, SEED_USER_PASSWORD: 'leak', DATABASE_DIRECT_URL: '', DATABASE_URL: ''
  } });
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 1);
  assert.ok(!(invalid.stdout + invalid.stderr).includes('leak'));
});

test('CLI usa DATABASE_URL quando a URL direta está ausente ou vazia e oculta erros de conexão', () => {
  const secret = 'Segredo-conexao-teste-2026';
  for (const directUrl of [undefined, '']) {
    const variables = { ...process.env, NODE_ENV: 'production', ...env,
      SEED_USER_PASSWORD: secret, DATABASE_URL: `postgresql://admin:${secret}@127.0.0.1:1/admin_test` };
    if (directUrl === undefined) delete variables.DATABASE_DIRECT_URL;
    else variables.DATABASE_DIRECT_URL = directUrl;
    const result = spawnSync(process.execPath, ['scripts/create-admin.js'], {
      encoding: 'utf8', env: variables, timeout: 15000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Falha ao cadastrar administrador/);
    assert.doesNotMatch(result.stdout + result.stderr, /Segredo-conexao|postgresql:|ECONNREFUSED/);
  }
});
