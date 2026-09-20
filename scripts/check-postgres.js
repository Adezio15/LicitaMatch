// Integração opt-in: executar via npm run test:postgres.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { root, localEnvironment, assertLocalTarget } from './lib/localPostgres.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger();
let admin, pool, app, testDatabase;
try {
  const { values } = await localEnvironment();
  assertLocalTarget(values);
  const secrets = JSON.parse(await readFile(join(root, '.local/postgres/credentials.json'), 'utf8'));
  const base = { host: '127.0.0.1', port: 55432, connectionTimeoutMillis: 10000, options: '-c timezone=UTC' };
  admin = new pg.Client({ ...base, database: 'postgres', user: 'licitamatch_admin', password: secrets.adminPassword });
  await admin.connect();
  testDatabase = `licitamatch_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(testDatabase)} OWNER licitamatch_app`);
  pool = new pg.Pool({ ...base, database: testDatabase, user: 'licitamatch_app', password: secrets.appPassword });
  pool.on('error', error => logger.error({ code: error.code }, 'Falha no pool de teste'));
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    const migrations = await readMigrations();
    const results = await Promise.all([runMigrations(first, migrations), runMigrations(second, migrations)]);
    assert.equal(results.flat().length, migrations.length);
    assert.equal(results.filter(result => result.length === 0).length, 1);
  } finally { first.release(); second.release(); }
  const role = await pool.query('SELECT rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user');
  assert.equal(role.rows[0].rolsuper, false);
  assert.equal(role.rows[0].rolcreatedb, false);
  app = createApp({ config: { NODE_ENV: 'test', TRUST_PROXY_HOPS: 0, SESSION_SECRET: randomBytes(48).toString('hex') }, database: pool, logger: createLogger('silent') });
  const agentA = request.agent(app);
  const agentB = request.agent(app);
  const password = randomBytes(24).toString('hex');
  const register = async (agent, cnpj, email) => {
    const token = (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
    return agent.post('/api/auth/register').set('X-CSRF-Token', token).send({
      razao_social: 'Teste temporário', cnpj, email_empresa: email, nome: 'Teste', email, senha: password
    }).expect(201);
  };
  const a = await register(agentA, '11222333000181', 'a@example.test');
  const b = await register(agentB, '11444777000161', 'b@example.test');
  await agentA.get('/api/usuarios/' + b.body.user.id).expect(404);
  await agentA.patch('/api/usuarios/' + b.body.user.id).set('X-CSRF-Token', a.body.csrfToken)
    .send({ nome: 'Tentativa', email: 'x@example.test', tipo: 'gestor', ativo: false }).expect(404);
  const company = await agentA.get('/api/empresa').expect(200);
  assert.equal(company.body.company.id, a.body.company.id);
  await agentA.post('/api/auth/logout').set('X-CSRF-Token', a.body.csrfToken).send({}).expect(204);
  await agentA.get('/api/auth/me').expect(401);
  const loginToken = (await agentA.get('/api/auth/csrf').expect(200)).body.csrfToken;
  await agentA.post('/api/auth/login').set('X-CSRF-Token', loginToken).send({ email: 'a@example.test', senha: password }).expect(200);
  await agentA.get('/conta').expect(200);
  const timezone = await pool.query('SHOW timezone');
  assert.equal(timezone.rows[0].TimeZone, 'UTC');
  logger.info('PostgreSQL real: migrations concorrentes, locks, permissões, cadastro, login, logout, isolamento e timezone validados.');
} catch (error) {
  logger.error({ code: error.code }, error.code ? 'Falha no teste PostgreSQL local.' : error.message);
  process.exitCode = 1;
} finally {
  if (app) await app.locals.sessionStore.close();
  if (pool) await pool.end();
  // Remove exclusivamente o banco temporário criado por esta execução.
  if (admin && /^licitamatch_test_[a-f0-9]{16}$/.test(testDatabase || '')) {
    await admin.query(`DROP DATABASE ${pg.escapeIdentifier(testDatabase)}`);
  }
  if (admin) await admin.end();
}
