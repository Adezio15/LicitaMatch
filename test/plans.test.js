import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { correlateOpportunities } from '../src/services/opportunityService.js';

const password = 'Senha-planos-teste-2026!';
const logger = createLogger('silent');
const config = parseEnv({ DATABASE_URL: 'postgresql://test:test@localhost/test', NODE_ENV: 'test', SESSION_SECRET: 'plans-tests-only-'.repeat(5) });

test('planos: migração, URLs, APIs, limites e alteração administrativa', async t => {
  const db = new PGlite();
  const migrations = await readMigrations();
  for (const m of migrations.filter(m => m.name < '011')) await db.exec(m.sql);
  await db.exec("INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Legada','00000000000001','legacy@test.dev')");
  for (const m of migrations.filter(m => m.name >= '011')) await db.exec(m.sql);
  assert.equal((await db.query('SELECT plano FROM empresas WHERE id=1')).rows[0].plano, 'start');
  await assert.rejects(db.query("UPDATE empresas SET plano='basico'"));
  const database = { query: (s,v) => db.query(s,v), connect: async () => ({ query: (s,v) => db.query(s,v), release() {} }) };
  const app = createApp({ config, database, logger });
  const hash = await bcrypt.hash(password, 4);
  const accounts = {};
  try {
    for (const [index, plan] of ['start','pro','premium','admin'].entries()) {
      const company = (await db.query('INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ($1,$2,$3,$4) RETURNING id',
        [plan, String(index+2).padStart(14,'0'), `${plan}@test.dev`, plan === 'admin' ? 'start' : plan])).rows[0];
      const user = (await db.query('INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [company.id,plan,`${plan}@test.dev`,hash,plan === 'admin' ? 'admin' : 'gestor'])).rows[0];
      const agent = request.agent(app);
      const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const login = await agent.post('/api/auth/login').set('X-CSRF-Token',token).send({ email:`${plan}@test.dev`,senha:password }).expect(200);
      accounts[plan] = { agent, token:login.body.csrfToken, company:company.id, user:user.id };
      await db.query("INSERT INTO interesses (empresa_id,titulo,palavras) VALUES ($1,'Informática',ARRAY['notebook'])",[company.id]);
    }
    await db.exec("INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade) VALUES ('PLAN-1','Compra de notebook',now(),'Secretaria','Pregão Eletrônico')");
    await correlateOpportunities(database);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM matches WHERE empresa_id=$1',[accounts.start.company])).rows[0].total,0);

    await t.test('acesso direto respeita recursos de cada plano e não aceita plano fornecido pelo cliente', async () => {
      for (const plan of ['start','pro','premium']) {
        const { agent,token } = accounts[plan];
        for (const path of ['/conta','/empresa','/busca','/oportunidades']) await agent.get(path).expect(200);
        const basic = await agent.get('/api/busca').expect(200);
        assert.equal(basic.body.total,1);
        assert.equal(basic.body.items[0].score,undefined);
        for (const path of ['/relatorios','/api/relatorios']) {
          const res = await agent.get(path).expect(plan === 'premium' ? 200 : 403);
          if (plan !== 'premium') assert.match(res.text,/upgrade/);
        }
        if (plan === 'premium') {
          const report = await agent.get('/api/relatorios').expect(200);
          assert.equal(report.body.tipo, 'oportunidades');
          assert.equal(report.body.total, 1);
          assert.equal(report.body.rows[0].score, 100);
        }
        for (const path of ['/conta/alertas','/api/conta/alertas']) await agent.post(path).set('X-CSRF-Token',token)
          .send({alertas_email:true}).expect(plan === 'start' ? 403 : path.startsWith('/api/') ? 200 : 303);
        for (const path of ['/conta/whatsapp','/api/conta/whatsapp']) await agent.post(path).set('X-CSRF-Token',token)
          .send({whatsapp_numero:'+5584999999999',alertas_whatsapp:true,confirmar_whatsapp:true})
          .expect(plan !== 'premium' ? 403 : path.startsWith('/api/') ? 200 : 303);
      }
      const { agent,token } = accounts.start;
      await agent.get('/api/oportunidades?score=1&plano=premium').expect(403);
      await agent.get('/oportunidades?status=novo').expect(403);
      await agent.patch('/api/oportunidades/1').set('X-CSRF-Token',token).send({status:'aceito'}).expect(403);
      await agent.post('/oportunidades/1').set('X-CSRF-Token',token).send({status:'aceito'}).expect(403);
      await agent.patch('/api/empresa').set('X-CSRF-Token',token).send({plano:'premium'}).expect(422);
      await agent.patch(`/api/admin/empresas/${accounts.start.company}/plano`).set('X-CSRF-Token',token).send({plano:'premium'}).expect(403);
      await agent.post(`/admin/empresas/${accounts.start.company}/plano`).set('X-CSRF-Token',token).send({plano:'premium'}).expect(403);
      const foreignInterest = (await db.query('SELECT id FROM interesses WHERE empresa_id=$1',[accounts.pro.company])).rows[0].id;
      assert.equal((await agent.get(`/api/busca?segmento=${foreignInterest}`).expect(200)).body.total,0);
    });

    await t.test('admin altera plano; sessão existente recebe e perde acesso imediatamente', async () => {
      const admin = accounts.admin;
      const path = `/api/admin/empresas/${accounts.start.company}/plano`;
      await admin.agent.patch(path).send({plano:'premium'}).expect(403);
      await admin.agent.patch(path).set('X-CSRF-Token',admin.token).send({plano:'invalido'}).expect(422);
      await admin.agent.patch(path).set('X-CSRF-Token',admin.token).send({plano:'premium'}).expect(200);
      await accounts.start.agent.get('/api/relatorios').expect(200);
      await correlateOpportunities(database);
      assert.ok((await accounts.start.agent.get('/api/oportunidades').expect(200)).body.items[0].score);
      await admin.agent.post(`/admin/empresas/${accounts.start.company}/plano`).set('X-CSRF-Token',admin.token).send({plano:'start'}).expect(303);
      await accounts.start.agent.get('/api/relatorios').expect(403);
      const result = await accounts.start.agent.get('/api/oportunidades').expect(200);
      assert.equal(result.body.items[0].score,undefined);
      assert.equal(result.body.items[0].status,undefined);
      assert.match((await accounts.start.agent.get('/conta').expect(200)).text,/Plano Start/);
      await admin.agent.get('/admin').expect(200);
    });

    await t.test('limites 1, 3 e 10 incluem gestor; criação e reativação verificam vagas', async () => {
      for (const [plan,limit] of Object.entries({start:1,pro:3,premium:10})) {
        const { agent,token,company } = accounts[plan];
        for (let n=1;n<limit;n++) await agent.post('/api/usuarios').set('X-CSRF-Token',token)
          .send({nome:`Pessoa ${n}`,email:`${plan}${n}@test.dev`,senha:password}).expect(201);
        await agent.post('/api/usuarios').set('X-CSRF-Token',token)
          .send({nome:'Excedente',email:`extra${plan}@test.dev`,senha:password}).expect(403);
        const inactive = (await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,ativo) VALUES ($1,'Inativo',$2,$3,false) RETURNING id",[company,`inactive${plan}@test.dev`,hash])).rows[0];
        const update = {nome:'Inativo',email:`inactive${plan}@test.dev`,tipo:'usuario',ativo:true};
        await agent.patch(`/api/usuarios/${inactive.id}`).set('X-CSRF-Token',token).send(update).expect(403);
        if (limit>1) {
          const active = (await db.query("SELECT id FROM usuarios WHERE empresa_id=$1 AND tipo='usuario' AND ativo=true LIMIT 1",[company])).rows[0];
          await db.query('UPDATE usuarios SET ativo=false WHERE id=$1',[active.id]);
          await agent.patch(`/api/usuarios/${inactive.id}`).set('X-CSRF-Token',token).send(update).expect(200);
          await agent.patch(`/api/usuarios/${inactive.id}`).set('X-CSRF-Token',token).send(update).expect(200);
        }
      }
      const admin=accounts.admin;
      await admin.agent.patch(`/api/admin/empresas/${accounts.premium.company}/plano`).set('X-CSRF-Token',admin.token).send({plano:'pro'}).expect(409);
      assert.equal((await db.query('SELECT plano FROM empresas WHERE id=$1',[accounts.premium.company])).rows[0].plano,'premium');
    });
  } finally { app.locals.sessionStore.close(); await db.close(); }
});

test('worker impede e-mail Start e WhatsApp Pro inclusive em filas anteriores ao downgrade', async () => {
  const db = new PGlite();
  for (const m of await readMigrations()) await db.exec(m.sql);
  const query = (s,v) => s.includes('pg_try_advisory_lock') ? Promise.resolve({rows:[{locked:true}]}) : s.includes('pg_advisory_unlock') ? Promise.resolve({rows:[]}) : db.query(s,v);
  const database = { query, connect: async () => ({query,release(){}}) };
  let worker;
  try {
    for (let id=1;id<=3;id++) {
      await db.query("INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ($1,$2,$3,'premium')",[`Empresa ${id}`,String(id).padStart(14,'0'),`${id}@test.dev`]);
      await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em) VALUES ($1,'Gestor',$2,'$2b$12$'||repeat('x',53),'gestor','+5584999999999',true,now())",[id,`${id}@test.dev`]);
      await db.query("INSERT INTO interesses (empresa_id,titulo,palavras) VALUES ($1,'Informática',ARRAY['notebook'])",[id]);
    }
    await db.exec("INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade) VALUES ('P-1','Compra de notebook',now(),'Secretaria','Pregão Eletrônico')");
    await correlateOpportunities(database);
    await db.exec("INSERT INTO alertas_empresa_email (empresa_id,licitacao_id,match_id) SELECT empresa_id,licitacao_id,id FROM matches; INSERT INTO alertas (match_id,usuario_id,canal) SELECT id,empresa_id,'whatsapp' FROM matches; UPDATE empresas SET plano='start' WHERE id=1; UPDATE empresas SET plano='pro' WHERE id=2;");
    const emails=[],whatsapps=[];
    worker = createOperationsService({ database, config:{...config,EMAIL_ENABLED:'true',WHATSAPP_ENABLED:'true'}, logger, registry:createSourceRegistry(),
      emailService:{sendMatchAlert:async p => {emails.push(p.to);return {messageId:'email'};}},
      whatsappService:{sendMatchAlert:async p => {whatsapps.push(p.customer);return {messageId:'whatsapp'};}} });
    await worker.runOnce();
    assert.deepEqual(emails.sort(),['2@test.dev','3@test.dev']);
    assert.deepEqual(whatsapps,['Empresa 3']);
    assert.equal((await db.query('SELECT status FROM alertas_empresa_email WHERE empresa_id=1')).rows[0].status,'pendente');
  } finally { await worker?.stop(); await db.close(); }
});
