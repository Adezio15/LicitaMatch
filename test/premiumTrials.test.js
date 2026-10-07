import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import { readMigrations } from '../src/services/migrationService.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { premiumTrialService } from '../src/services/premiumTrialService.js';
import { companyPlan, getEffectivePlan } from '../src/services/planService.js';
const config = parseEnv({DATABASE_URL:'postgresql://test:test@localhost/test',NODE_ENV:'test',SESSION_SECRET:'premium-trial-test-secret-'.repeat(4)});
const logger = createLogger('silent');
test('plano efetivo expira no instante exato e preserva assinatura paga', () => {
 const end = Date.parse('2026-10-07T15:00:00Z');
 for (const plano of ['sem_plano','premium_teste','start','pro','premium']) {
  const company = {plano,teste_status:'ativo',teste_fim:new Date(end)};
  assert.equal(getEffectivePlan(company,end-1),'premium');
  const fallback = ['start','pro','premium'].includes(plano) ? plano : 'sem_plano';
  assert.equal(getEffectivePlan(company,end),fallback);
  assert.equal(getEffectivePlan(company,end+1),fallback);
 }
 assert.equal(getEffectivePlan({plano:'sem_plano',teste_status:'aguardando_aprovacao',teste_fim:new Date(end)},end-1),'sem_plano');
});
test('migration de teste preserva todos os planos já existentes',async()=>{
 const db = new PGlite();
 try {
  const migrations = await readMigrations();
  for(const migration of migrations.filter(m=>m.name<'012')) await db.exec(migration.sql);
  for(const [index,plan] of ['start','pro','premium'].entries()) await db.query(
   'INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ($1,$2,$3,$1)',
   [plan,String(index+1).padStart(14,'0'),`${plan}@test.dev`]);
  for(const migration of migrations.filter(m=>m.name>='012')) await db.exec(migration.sql);
  assert.deepEqual((await db.query('SELECT plano FROM empresas ORDER BY id')).rows.map(e=>e.plano),['start','pro','premium']);
  const newCompany=(await db.query("INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Nova','00000000000004','nova@test.dev') RETURNING plano,teste_status")).rows[0];
  assert.deepEqual(newCompany,{plano:'sem_plano',teste_status:'nao_solicitado'});
 } finally {await db.close();}
});
test('teste Premium: cadastro, proteção HTTP, aprovação, expiração e histórico por empresa/CNPJ',async()=>{
 const db=new PGlite();
 for(const m of await readMigrations()) await db.exec(m.sql);
 const database={query:(s,v)=>db.query(s,v),connect:async()=>({query:(s,v)=>db.query(s,v),release(){}})};
 const app=createApp({database,config,logger});
 try {
 const agent=request.agent(app);
 const token=(await agent.get('/api/auth/csrf')).body.csrfToken;
 const registration=await agent.post('/api/auth/register').set('X-CSRF-Token',token).send({razao_social:'Nova Empresa',cnpj:'11222333000181',email_empresa:'empresa@test.dev',nome:'Gestor Teste',email:'gestor@test.dev',senha:'Senha-segura-testes-2026!'}).expect(201);
 const user=registration.body.user, csrf=registration.body.csrfToken;
 const admin=(await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo) SELECT empresa_id,'Administrador','admin@test.dev',senha_hash,'admin' FROM usuarios WHERE id=$1 RETURNING id",[user.id])).rows[0];
 const adminAgent=request.agent(app);
 const adminToken=(await adminAgent.get('/api/auth/csrf')).body.csrfToken;
 const adminCsrf=(await adminAgent.post('/api/auth/login').set('X-CSRF-Token',adminToken).send({email:'admin@test.dev',senha:'Senha-segura-testes-2026!'}).expect(200)).body.csrfToken;
 assert.equal(registration.body.company.plano,'sem_plano');
 assert.equal(registration.body.company.teste_status,'nao_solicitado');
 const interest=(await agent.post('/api/interesses').set('X-CSRF-Token',csrf).send({titulo:'Tecnologia',palavras:'notebook'}).expect(201)).body.interest;
 await agent.patch(`/api/interesses/${interest.id}`).set('X-CSRF-Token',csrf).send({titulo:'Informática',palavras:'notebook'}).expect(200);
 await db.exec("INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade) VALUES ('SEGREDO-EDITAL','Compra secreta de notebook',now(),'Órgão protegido','Pregão Eletrônico')");
 for(const path of ['/api/busca?q=secreta','/api/oportunidades?plano=premium']) {
  const res=await agent.get(path).expect(200); assert.equal(res.body.total,1); assert.equal(res.body.items,undefined); assert.doesNotMatch(res.text,/SEGREDO|Compra secreta|Órgão protegido/);
 }
 await agent.get('/api/oportunidades/1').expect(403);
 for(const path of ['/conta','/busca','/oportunidades','/conta/seguranca']) {const res=await agent.get(path).expect(200);assert.doesNotMatch(res.text,/Compra secreta|Órgão protegido/);}
 await agent.get('/api/relatorios').expect(403);
 await agent.patch('/api/oportunidades/1').set('X-CSRF-Token',csrf).send({status:'aceito'}).expect(403);
 await agent.post('/api/testes-premium').expect(403);
 await agent.post('/api/testes-premium').set('X-CSRF-Token',csrf).expect(201);
 assert.match((await agent.get('/conta').expect(200)).text,/Teste solicitado - aguardando aprovação/);
 await agent.post('/api/testes-premium').set('X-CSRF-Token',csrf).expect(403);
 assert.equal((await db.query('SELECT count(*)::int n FROM testes_premium')).rows[0].n,1);
 const trials=premiumTrialService(database,config,logger);
 const trial=(await trials.list())[0];
 await agent.post(`/api/admin/testes-premium/${trial.id}/aprovar`).set('X-CSRF-Token',csrf).expect(403);
 await agent.get('/api/admin/testes-premium').expect(403);
 await adminAgent.get('/admin/testes-premium').expect(200);
 await adminAgent.get(`/api/admin/testes-premium/${trial.id}`).expect(200);
 await adminAgent.post(`/api/admin/testes-premium/${trial.id}/aprovar`).expect(403);
 await adminAgent.post(`/api/admin/testes-premium/${trial.id}/aprovar`).set('X-CSRF-Token',adminCsrf).expect(200);
 const e=(await db.query('SELECT * FROM empresas WHERE id=$1',[user.empresa_id])).rows[0];
 assert.equal(e.teste_fim-e.teste_inicio,86400000);
 assert.equal(String(e.teste_aprovado_por),String(admin.id));
 assert.equal(e.teste_utilizado_em.getTime(),e.teste_inicio.getTime());
 const approved=(await trials.list(trial.id))[0];
 assert.equal(approved.inicio_em.getTime(),e.teste_inicio.getTime());
 assert.equal(approved.fim_em.getTime(),e.teste_fim.getTime());
 await agent.get('/api/oportunidades/1').expect(200);
 await agent.get('/api/relatorios').expect(200);
 await assert.rejects(trials.decide(trial.id,user,true),{status:409});
 await db.query("UPDATE empresas SET teste_fim=now()-interval '1 second' WHERE id=$1",[user.empresa_id]);
 await agent.get('/api/relatorios').expect(403);
 await agent.get('/api/oportunidades/1').expect(403);
 assert.equal(await companyPlan(database,user.empresa_id),'sem_plano');
 assert.equal((await db.query('SELECT teste_status FROM empresas WHERE id=$1',[user.empresa_id])).rows[0].teste_status,'expirado');
 assert.equal((await trials.list(trial.id))[0].status,'expirado');
 await agent.post('/api/testes-premium').set('X-CSRF-Token',csrf).expect(403);
 const member=(await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash) SELECT empresa_id,'Outro usuário','outro@test.dev',senha_hash FROM usuarios WHERE id=$1 RETURNING id",[user.id])).rows[0];
 const another={...user,id:member.id};
 await assert.rejects(trials.request(another,{ip:'127.0.0.2',userAgent:'manual'}),{status:403});
 await db.query("UPDATE empresas SET plano='pro' WHERE id=$1",[user.empresa_id]);
 assert.equal(await companyPlan(database,user.empresa_id),'pro');
 await db.query("UPDATE empresas SET teste_status='ativo',teste_fim=now()+interval '1 hour' WHERE id=$1",[user.empresa_id]);
 assert.equal(await companyPlan(database,user.empresa_id),'premium');
 await db.query("UPDATE empresas SET teste_fim=now()-interval '1 second' WHERE id=$1",[user.empresa_id]);
 assert.equal(await companyPlan(database,user.empresa_id),'pro');
 await db.query("UPDATE empresas SET plano='premium' WHERE id=$1",[user.empresa_id]);
 assert.equal(await companyPlan(database,user.empresa_id),'premium');
 // Changing current CNPJ never discards historical eligibility records.
 await db.query("UPDATE empresas SET cnpj='11444777000161' WHERE id=$1",[user.empresa_id]);
 await assert.rejects(trials.request(user,{ip:'127.0.0.1'}),{status:403});
 assert.ok((await db.query('SELECT count(*)::int n FROM notificacoes_plano')).rows[0].n>=1);
 const notifications=(await db.query('SELECT * FROM notificacoes_plano')).rows;
 for(const subject of ['Nova solicitação de teste Premium - LicitaMatch','Seu teste Premium foi aprovado!','Alerta - tentativa de reutilização do teste Premium']) assert.ok(notifications.some(n=>n.assunto===subject));
 const attempt=(await db.query('SELECT * FROM testes_premium_tentativas WHERE user_agent=$1',['manual'])).rows[0];
 assert.equal(String(attempt.usuario_id),String(member.id));
 assert.equal(attempt.ip,'127.0.0.2');
 const other=(await db.query("INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Outra empresa','11222333000181','outra@test.dev') RETURNING id")).rows[0];
 await assert.rejects(trials.request({...another,empresa_id:other.id},{ip:'127.0.0.1'}),{status:403});
 const refused=(await db.query("INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Recusada','12345678000195','recusada@test.dev') RETURNING id")).rows[0];
 await trials.request({...user,empresa_id:refused.id},{ip:'127.0.0.1'});
 const pending=(await trials.list()).find(t=>String(t.empresa_id)===String(refused.id));
 await trials.decide(pending.id,user,false);
 assert.equal(await companyPlan(database,refused.id),'sem_plano');
 await assert.rejects(trials.request({...user,empresa_id:refused.id},{ip:'127.0.0.1'}),{status:403});
 // A transport outage must leave durable notifications for the next worker pass.
 const delivered=[];
 let unavailable=true;
 const mailer=premiumTrialService(database,{...config,EMAIL_ENABLED:'true',EMAIL_FROM:'LicitaMatch <app@test.dev>'},logger,async ({payload})=>{
  if(unavailable) throw new Error('SMTP indisponível');
  delivered.push(payload);
 });
 await mailer.flushEmails();
 assert.equal((await db.query('SELECT count(*)::int n FROM notificacoes_plano WHERE enviado_em IS NOT NULL')).rows[0].n,0);
 unavailable=false;
 await mailer.flushEmails();
 assert.ok(delivered.some(p=>p.to==='gestor@test.dev' && p.subject==='Seu teste Premium foi aprovado!' && /Brasília/.test(p.text)));
 assert.ok(delivered.some(p=>p.to==='admin@test.dev' && p.subject==='Nova solicitação de teste Premium - LicitaMatch'));
 assert.ok(delivered.some(p=>p.subject==='Sua solicitação de teste Premium foi recusada'));
 const count=delivered.length;
 await mailer.flushEmails();
 assert.equal(delivered.length,count);
 } finally {app.locals.sessionStore.close();await db.close();}
});
