import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { readMigrations } from '../src/services/migrationService.js';
import { seedDevelopment } from '../src/services/seedService.js';
import { passwordSchema, validCnpj } from '../src/utils/validation.js';

const password = 'Senha-de-teste-2026!';
const config = parseEnv({ DATABASE_URL: 'postgresql://test:test@localhost/test', NODE_ENV: 'test', SESSION_SECRET: 'only-for-automated-tests-'.repeat(3) });
const logger = createLogger('silent');
const registration = (email, cnpj) => ({
  razao_social: 'Empresa de Teste LTDA', nome_fantasia: 'Empresa de Teste', cnpj,
  email_empresa: email, cidade: 'Mossoró', estado: 'RN', nome: 'Gestor Teste', email, senha: password
});
const cookieOf = response => response.headers['set-cookie']?.find(cookie => cookie.startsWith('licitamatch.sid='))?.split(';')[0];

test('validação de CNPJ e limites bcrypt em bytes', () => {
  assert.equal(validCnpj('11222333000181'), true);
  assert.equal(validCnpj('11444777000161'), true);
  assert.equal(validCnpj('12345678000195'), true);
  assert.equal(validCnpj('00000000000000'), false);
  assert.equal(validCnpj('11222333000180'), false);
  assert.equal(passwordSchema.safeParse('a'.repeat(72)).success, true);
  assert.equal(passwordSchema.safeParse('á'.repeat(37)).success, false);
  assert.equal(passwordSchema.safeParse('curta').success, false);
});

test('autenticação e isolamento com SQL e sessões persistidas', async t => {
  const db = new PGlite();
  for (const migration of await readMigrations()) await db.exec(migration.sql);
  // Adaptador de pool: consultas e session store reais, sem mocks de autorização ou SQL.
  const database = {
    query: (sql, values) => db.query(sql, values),
    connect: async () => ({ query: (sql, values) => db.query(sql, values), release() {} })
  };
  const app = createApp({ config, database, logger });
  const stores = [app.locals.sessionStore];
  const a = request.agent(app);
  const b = request.agent(app);
  let csrfA, csrfB, userA, userB, member, aCookie;
  const token = async agent => (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  const signIn = async (agent, email, extra = {}) => {
    const csrfToken = await token(agent);
    return agent.post('/api/auth/login').set('X-CSRF-Token', csrfToken).send({ email, senha: password, ...extra });
  };
  try {
    await t.test('páginas públicas renderizam e rotas privadas exigem login', async () => {
      const page = await a.get('/login').expect(200);
      assert.match(page.text, /Acesse sua conta/);
      assert.match(page.text, /name="_csrf"/);
      await a.get('/cadastro').expect(200);
      await a.get('/conta').expect(303).expect('Location', '/login');
      await a.get('/api/empresa').expect(401);
      await a.get('/api/usuarios').expect(401);
    });

    await t.test('CSRF obrigatório inclusive no login, sem cookie emitido pelo healthcheck', async () => {
      await request(app).post('/api/auth/login').send({ email: 'a@example.test', senha: password }).expect(403);
      const health = await request(app).get('/health/live').expect(200);
      assert.equal(health.headers['set-cookie'], undefined);
      await a.post('/api/auth/register').set('X-CSRF-Token', 'f'.repeat(64)).send(registration('a@example.test', '11222333000181')).expect(403);
    });

    await t.test('cadastro cria empresa e gestor, armazena bcrypt e renova sessão', async () => {
      const before = await request(app).get('/api/auth/csrf').expect(200);
      const oldCookie = cookieOf(before);
      const response = await request(app).post('/api/auth/register').set('Cookie', oldCookie)
        .set('X-CSRF-Token', before.body.csrfToken).send(registration('a@example.test', '11.222.333/0001-81')).expect(201);
      userA = response.body.user;
      assert.equal(userA.tipo, 'gestor');
      assert.equal(response.body.company.cnpj, '11222333000181');
      assert.equal(response.body.user.senha_hash, undefined);
      assert.notEqual(cookieOf(response), oldCookie);
      await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
      const login = await signIn(a, 'A@EXAMPLE.TEST');
      assert.equal(login.status, 200);
      csrfA = login.body.csrfToken;
      aCookie = cookieOf(login);
      assert.match(login.headers['set-cookie'][0], /HttpOnly/);
      assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);
      assert.doesNotMatch(login.headers['set-cookie'][0], /Expires=/);
      const { rows } = await db.query('SELECT senha_hash FROM usuarios WHERE id=$1', [userA.id]);
      assert.ok(await bcrypt.compare(password, rows[0].senha_hash));
      assert.equal(bcrypt.getRounds(rows[0].senha_hash), 12);
      assert.notEqual(rows[0].senha_hash, password);
      const sessionRows = await db.query('SELECT sess FROM sessoes');
      assert.ok(sessionRows.rows.some(row => row.sess.userId === String(userA.id)));
      assert.ok(!JSON.stringify(sessionRows.rows).includes('senha_hash'));
    });

    await t.test('segunda empresa recebe dados separados; duplicidade reverte cadastro inteiro', async () => {
      const registrationToken = await token(b);
      const response = await b.post('/api/auth/register').set('X-CSRF-Token', registrationToken)
        .send(registration('b@example.test', '11444777000161')).expect(201);
      userB = response.body.user;
      csrfB = response.body.csrfToken;
      assert.notEqual(userA.empresa_id, userB.empresa_id);
      const duplicateAgent = request.agent(app);
      const duplicateToken = await token(duplicateAgent);
      await duplicateAgent.post('/api/auth/register').set('X-CSRF-Token', duplicateToken)
        .send(registration('a@example.test', '12345678000195')).expect(409);
      const { rows } = await db.query("SELECT count(*)::int AS count FROM empresas WHERE cnpj='12345678000195'");
      assert.equal(rows[0].count, 0);
      await duplicateAgent.post('/api/auth/register').set('X-CSRF-Token', duplicateToken)
        .send({ ...registration('hack@example.test', '12345678000195'), tipo: 'admin', plano: 'premium' }).expect(422);
    });

    await t.test('não permite listar, ler ou alterar usuários de outra empresa', async () => {
      const users = await a.get('/api/usuarios?empresa_id=' + userB.empresa_id).expect(200);
      assert.ok(users.body.users.every(user => String(user.empresa_id) === String(userA.empresa_id)));
      assert.ok(!JSON.stringify(users.body).includes('senha_hash'));
      await a.get('/api/usuarios/' + userB.id).expect(404);
      await a.get('/usuarios/' + userB.id).expect(404);
      await a.patch('/api/usuarios/' + userB.id).set('X-CSRF-Token', csrfA)
        .send({ nome: 'Invadido', email: 'invadido@example.test', tipo: 'gestor', ativo: false }).expect(404);
      const other = await b.get('/api/auth/me').expect(200);
      assert.equal(other.body.user.email, 'b@example.test');
      const company = await a.get('/api/empresa?empresa_id=' + userB.empresa_id).expect(200);
      assert.equal(String(company.body.company.id), String(userA.empresa_id));
      await a.patch('/api/empresa').set('X-CSRF-Token', csrfA)
        .send({ razao_social: 'Ataque', email_empresa: 'x@example.test', empresa_id: userB.empresa_id }).expect(422);
      await a.post('/api/usuarios').set('X-CSRF-Token', csrfB)
        .send({ nome: 'Teste', email: 'x@example.test', senha: password }).expect(403);
      await a.post('/api/usuarios').set('X-CSRF-Token', csrfA)
        .send({ nome: 'Teste', email: 'x@example.test', senha: password, empresa_id: userB.empresa_id }).expect(422);
      await a.get('/api/usuarios/1%20OR%201=1').expect(404);
    });

    await t.test('gestor edita sua empresa e cria usuário sem poder elevar para admin', async () => {
      await a.patch('/api/empresa').set('X-CSRF-Token', csrfA)
        .send({ razao_social: '<script>alert(1)</script>', email_empresa: 'empresa-a@example.test', cidade: 'Natal', estado: 'RN' }).expect(200);
      const page = await a.get('/empresa').expect(200);
      assert.ok(page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(!page.text.includes('<script>alert(1)</script>'));
      const bCompany = await b.get('/api/empresa').expect(200);
      assert.equal(bCompany.body.company.razao_social, 'Empresa de Teste LTDA');
      await a.post('/api/usuarios').set('X-CSRF-Token', csrfA)
        .send({ nome: 'Admin', email: 'admin@example.test', senha: password, tipo: 'admin' }).expect(422);
      const response = await a.post('/api/usuarios').set('X-CSRF-Token', csrfA)
        .send({ nome: 'Usuário comum', email: 'member@example.test', senha: password, tipo: 'usuario' }).expect(201);
      member = response.body.user;
      assert.equal(String(member.empresa_id), String(userA.empresa_id));
      await a.patch('/api/usuarios/' + userA.id).set('X-CSRF-Token', csrfA)
        .send({ nome: 'Gestor', email: 'a@example.test', tipo: 'usuario', ativo: false }).expect(422);
      for (const url of ['/conta', '/usuarios', '/usuarios/' + member.id]) await a.get(url).expect(200);
    });

    await t.test('dashboard usa dados reais da empresa e lista oportunidades prioritárias', async () => {
      await db.query(`INSERT INTO licitacoes_pncp (codigo_externo, objeto, data_abertura, unidade_gestora, modalidade)
        VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
        ['L-1001', 'Compra de veículos para iluminação pública municipal', '2026-09-01T12:00:00Z', 'Prefeitura Municipal', 'Pregão Eletrônico',
          'L-1002', 'Contratação de pavimentação e manutenção de vias urbanas', '2026-09-02T12:00:00Z', 'Secretaria de Obras', 'Tomada de Preços']);
      await db.query(`INSERT INTO interesses (empresa_id, titulo, palavras)
        VALUES ($1, $2, $3), ($1, $4, $5)`,
        [userA.empresa_id, 'Infraestrutura e logística', ['infraestrutura', 'obras', 'veiculos'], 'Mobilidade urbana', ['pavimentacao', 'vias', 'logistica']]);
      const { rows: interests } = await db.query('SELECT id, titulo FROM interesses WHERE empresa_id=$1 ORDER BY id', [userA.empresa_id]);
      const { rows: licitacoes } = await db.query('SELECT id, objeto FROM licitacoes_pncp ORDER BY id DESC LIMIT 2');
      await db.query(`INSERT INTO matches (interesse_id, licitacao_id, empresa_id, score, status)
        VALUES ($1, $2, $3, $4, $5), ($6, $7, $3, $8, $9)`,
        [interests[0].id, licitacoes[0].id, userA.empresa_id, 90, 'novo', interests[1].id, licitacoes[1].id, 75, 'revisado']);
      const page = await a.get('/conta').expect(200);
      assert.match(page.text, /Interesses ativos/);
      assert.match(page.text, /Infraestrutura e logística/);
      assert.match(page.text, /90%/);
      assert.match(page.text, /Contratação de pavimentação e manutenção de vias urbanas/);
    });

    await t.test('usuário comum não administra empresa nem equipe; desativação revoga acesso', async () => {
      const agent = request.agent(app);
      const response = await signIn(agent, 'member@example.test');
      assert.equal(response.status, 200);
      const csrf = response.body.csrfToken;
      await agent.get('/api/empresa').expect(200);
      await agent.get('/api/usuarios').expect(403);
      await agent.patch('/api/empresa').set('X-CSRF-Token', csrf).send({}).expect(403);
      await agent.post('/api/usuarios').set('X-CSRF-Token', csrf).send({}).expect(403);
      await a.patch('/api/usuarios/' + member.id).set('X-CSRF-Token', csrfA)
        .send({ nome: member.nome, email: member.email, tipo: 'usuario', ativo: false }).expect(200);
      await agent.get('/api/auth/me').expect(401);
      const inactive = await signIn(request.agent(app), member.email);
      assert.equal(inactive.status, 401);
    });

    await t.test('e-mail inexistente e senha incorreta retornam o mesmo erro', async () => {
      const wrong = await signIn(request.agent(app), 'a@example.test', { senha: 'senha-errada' });
      const absent = await signIn(request.agent(app), 'absent@example.test');
      assert.equal(wrong.status, 401);
      assert.equal(absent.status, 401);
      assert.equal(wrong.body.error, absent.body.error);
      assert.equal(wrong.body.error, 'E-mail ou senha inválidos');
    });

    await t.test('lembrar acesso usa cookie persistente; sessão sobrevive a outra instância', async () => {
      const remembered = await signIn(request.agent(app), 'a@example.test', { lembrar: true });
      assert.equal(remembered.status, 200);
      assert.match(remembered.headers['set-cookie'][0], /Expires=/);
      const app2 = createApp({ config, database, logger });
      stores.push(app2.locals.sessionStore);
      const me = await request(app2).get('/api/auth/me').set('Cookie', cookieOf(remembered)).expect(200);
      assert.equal(me.body.user.email, 'a@example.test');
      await request(app2).post('/api/auth/logout').set('Cookie', cookieOf(remembered))
        .set('X-CSRF-Token', remembered.body.csrfToken).send({}).expect(204);
      await request(app).get('/api/auth/me').set('Cookie', cookieOf(remembered)).expect(401);
    });

    await t.test('sessão tem expiração absoluta e cookie Secure em produção', async () => {
      const expiryLogin = await signIn(request.agent(app), 'a@example.test');
      const cookie = cookieOf(expiryLogin);
      const { rows } = await db.query('SELECT sid,sess FROM sessoes');
      for (const row of rows) {
        if (row.sess.csrfToken === expiryLogin.body.csrfToken) {
          await db.query('UPDATE sessoes SET sess=$1 WHERE sid=$2', [{ ...row.sess, expiresAt: Date.now() - 1000 }, row.sid]);
        }
      }
      await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
      const productionApp = createApp({ config: { ...config, NODE_ENV: 'production', TRUST_PROXY_HOPS: 1 }, database, logger });
      stores.push(productionApp.locals.sessionStore);
      const https = await request(productionApp).get('/api/auth/csrf').set('X-Forwarded-Proto', 'https').expect(200);
      assert.match(https.headers['set-cookie'][0], /Secure/);
      assert.match(https.headers['set-cookie'][0], /HttpOnly/);
    });

    await t.test('suspensão da empresa bloqueia sessão e novo login', async () => {
      await db.query("UPDATE empresas SET status='suspenso' WHERE id=$1", [userB.empresa_id]);
      await b.get('/api/auth/me').expect(401);
      const blocked = await signIn(request.agent(app), 'b@example.test');
      assert.equal(blocked.status, 401);
      await db.query("UPDATE empresas SET status='ativo' WHERE id=$1", [userB.empresa_id]);
    });

    await t.test('troca de senha exige a atual e invalida todas as sessões anteriores', async () => {
      const anotherSession = await signIn(request.agent(app), 'a@example.test');
      assert.equal(anotherSession.status, 200);
      await a.post('/api/auth/password').set('X-CSRF-Token', csrfA)
        .send({ senha_atual: 'incorreta', senha: 'Minha-nova-senha-2026!' }).expect(422);
      await a.post('/api/auth/password').set('X-CSRF-Token', csrfA)
        .send({ senha_atual: password, senha: 'Minha-nova-senha-2026!' }).expect(204);
      await a.get('/api/auth/me').expect(401);
      await request(app).get('/api/auth/me').set('Cookie', aCookie).expect(401);
      await request(app).get('/api/auth/me').set('Cookie', cookieOf(anotherSession)).expect(401);
      const oldLogin = await signIn(request.agent(app), 'a@example.test');
      assert.equal(oldLogin.status, 401);
      const newLogin = await signIn(request.agent(app), 'a@example.test', { senha: 'Minha-nova-senha-2026!' });
      assert.equal(newLogin.status, 200);
    });

    await t.test('seed só em desenvolvimento, sem senha padrão e sem redefinir usuário existente', async () => {
      await assert.rejects(seedDevelopment(database, { NODE_ENV: 'production', SEED_USER_PASSWORD: password }), /development/);
      await assert.rejects(seedDevelopment(database, { NODE_ENV: 'development' }));
      const before = await db.query('SELECT senha_hash FROM usuarios WHERE id=$1', [userA.id]);
      assert.equal(await seedDevelopment(database, { NODE_ENV: 'development', SEED_USER_PASSWORD: password }), false);
      const after = await db.query('SELECT senha_hash FROM usuarios WHERE id=$1', [userA.id]);
      assert.equal(before.rows[0].senha_hash, after.rows[0].senha_hash);
    });

    await t.test('formulários HTML concluem cadastro, logout, erro e login', async () => {
      const agent = request.agent(app);
      const csrfFrom = html => html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
      const form = await agent.get('/cadastro').expect(200);
      await agent.post('/cadastro').type('form').set('Accept', 'text/html')
        .send({ ...registration('form@example.test', '12345678000195'), _csrf: csrfFrom(form.text) })
        .expect(303).expect('Location', '/conta');
      const account = await agent.get('/conta').expect(200);
      await agent.post('/logout').type('form').send({ _csrf: csrfFrom(account.text) }).expect(303).expect('Location', '/login');
      const login = await agent.get('/login').expect(200);
      await agent.post('/login').type('form').set('Accept', 'text/html')
        .send({ email: 'form@example.test', senha: 'incorreta', _csrf: csrfFrom(login.text) }).expect(401).expect(/E-mail ou senha inválidos/);
      await agent.post('/login').type('form').send({ email: 'form@example.test', senha: password, lembrar: 'on', _csrf: csrfFrom(login.text) })
        .expect(303).expect('Location', '/conta');
      await agent.get('/conta').expect(200);
    });

    await t.test('limita tentativas de login', async () => {
      const limitedApp = createApp({ config, database, logger });
      stores.push(limitedApp.locals.sessionStore);
      const agent = request.agent(limitedApp);
      const csrf = await token(agent);
      for (let i = 0; i < 10; i++) {
        await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'invalid', senha: '' }).expect(401);
      }
      await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'invalid', senha: '' }).expect(429);
    });
  } finally {
    for (const store of stores) await store.close();
    await db.close();
  }
});

test('seed cria empresa/gestor com bcrypt e é idempotente em banco vazio', async () => {
  const db = new PGlite();
  const database = {
    query: (sql, values) => db.query(sql, values),
    connect: async () => ({ query: (sql, values) => db.query(sql, values), release() {} })
  };
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    const env = { NODE_ENV: 'development', SEED_USER_EMAIL: 'seed@example.test', SEED_USER_PASSWORD: password };
    assert.equal(await seedDevelopment(database, env), true);
    assert.equal(await seedDevelopment(database, env), false);
    const { rows } = await db.query('SELECT u.tipo,u.senha_hash,e.razao_social FROM usuarios u JOIN empresas e ON e.id=u.empresa_id');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tipo, 'gestor');
    assert.equal(rows[0].razao_social, 'Empresa Exemplo LTDA');
    assert.ok(await bcrypt.compare(password, rows[0].senha_hash));
  } finally { await db.close(); }
});

test('seed cria empresa/admin quando a role for informada', async () => {
  const db = new PGlite();
  const database = {
    query: (sql, values) => db.query(sql, values),
    connect: async () => ({ query: (sql, values) => db.query(sql, values), release() {} })
  };
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    const env = {
      NODE_ENV: 'development',
      SEED_USER_ROLE: 'admin',
      SEED_USER_EMAIL: 'admin.local@example.test',
      SEED_USER_PASSWORD: password
    };
    assert.equal(await seedDevelopment(database, env), true);
    const { rows } = await db.query('SELECT u.tipo,u.email,u.senha_hash FROM usuarios u');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tipo, 'admin');
    assert.equal(rows[0].email, 'admin.local@example.test');
    assert.ok(await bcrypt.compare(password, rows[0].senha_hash));
  } finally { await db.close(); }
});
