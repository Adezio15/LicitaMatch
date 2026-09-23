import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import test from 'node:test';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { readMigrations } from '../src/services/migrationService.js';

const config = parseEnv({ DATABASE_URL: 'postgresql://test:test@localhost/test', NODE_ENV: 'test', SESSION_SECRET: 'only-for-automated-tests-'.repeat(3) });
const logger = createLogger('silent');

test('admin global acessa painel geral e gestores comuns não acessam', async () => {
  const db = new PGlite();
  for (const migration of await readMigrations()) await db.exec(migration.sql);
  const database = { query: (sql, values) => db.query(sql, values), connect: async () => ({ query: (sql, values) => db.query(sql, values), release() {} }) };
  const app = createApp({ config, database, logger });

  const adminAgent = request.agent(app);
  const gestorAgent = request.agent(app);

  const adminCompany = (await db.query(`INSERT INTO empresas (razao_social, nome_fantasia, cnpj, email, cidade, estado)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, ['Empresa Administrativa LTDA', 'Empresa Administrativa LTDA', '11222333000181', 'admin@local.test', 'Mossoró', 'RN'])).rows[0];
  const adminHash = await bcrypt.hash('Senha-de-teste-2026!', 12);
  await db.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, tipo) VALUES ($1,$2,$3,$4,$5)`, [adminCompany.id, 'Admin Local', 'admin@local.test', adminHash, 'admin']);

  const gestorCompany = (await db.query(`INSERT INTO empresas (razao_social, nome_fantasia, cnpj, email, cidade, estado)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, ['Empresa Gestora LTDA', 'Empresa Gestora LTDA', '11444777000161', 'gestor@local.test', 'Mossoró', 'RN'])).rows[0];
  const gestorHash = await bcrypt.hash('Senha-de-teste-2026!', 12);
  await db.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, tipo) VALUES ($1,$2,$3,$4,$5)`, [gestorCompany.id, 'Gestor Local', 'gestor@local.test', gestorHash, 'gestor']);

  const adminLoginAgent = request.agent(app);
  const adminLoginCsrf = (await adminLoginAgent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  const adminLoginRedirect = await adminLoginAgent.post('/login')
    .redirects(0)
    .set('X-CSRF-Token', adminLoginCsrf)
    .send({ email: 'admin@local.test', senha: 'Senha-de-teste-2026!' })
    .expect(303);
  assert.equal(adminLoginRedirect.headers.location, '/admin');

  const adminCsrf = (await adminAgent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  const adminLogin = await adminAgent.post('/api/auth/login')
    .set('X-CSRF-Token', adminCsrf)
    .send({ email: 'admin@local.test', senha: 'Senha-de-teste-2026!' })
    .expect(200);
  assert.equal(adminLogin.body.user.tipo, 'admin');

  const gestorCsrf = (await gestorAgent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  const gestorLogin = await gestorAgent.post('/api/auth/login')
    .set('X-CSRF-Token', gestorCsrf)
    .send({ email: 'gestor@local.test', senha: 'Senha-de-teste-2026!' })
    .expect(200);
  assert.equal(gestorLogin.body.user.tipo, 'gestor');

  const adminPage = await adminAgent.get('/admin').expect(200);
  assert.match(adminPage.text, /Painel administrativo/i);
  assert.match(adminPage.text, /Empresa Administrativa LTDA/i);

  await gestorAgent.get('/admin').expect(403);
  await gestorAgent.get('/api/admin/empresas').expect(403);
  await adminAgent.get('/api/admin/empresas').expect(200);
});
