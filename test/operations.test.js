import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { createPncpSource } from '../src/services/sources/pncpSource.js';
import { createComprasnetSource } from '../src/services/sources/comprasnetSource.js';
import { createEmailService } from '../src/services/emailService.js';
import { createCronService } from '../src/services/cronService.js';
import { persistPncpItems } from '../src/services/pncpPersistenceService.js';
import { correlateOpportunities } from '../src/services/opportunityService.js';

const config = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', SESSION_SECRET: 'automated-tests-only-'.repeat(4), PNCP_MODALIDADES: '6', COMPRASNET_MODALIDADES: '5', SYNC_MAX_PAGES: 1 });
const logger = createLogger('silent');
const item = { id:'12345678000199-1-000001-2026',objeto:'Compra de notebooks',unidadeGestora:'Secretaria de Educação',dataAbertura:'2026-09-25T12:00:00Z',modalidade:'Pregão' };

test('adapters leem Response real uma única vez e usam campos e parâmetros oficiais', async () => {
  const pncp = createPncpSource({ fetchImpl: async url => {
    assert.equal(url.pathname,'/api/consulta/v1/contratacoes/publicacao');
    assert.equal(url.searchParams.get('pagina'),'2');
    assert.equal(url.searchParams.get('dataInicial'),'20260901');
    return new Response(JSON.stringify({ data: [{ numeroControlePNCP:item.id,objetoCompra:item.objeto,dataAberturaProposta:item.dataAbertura,unidadeOrgao:{nomeUnidade:item.unidadeGestora},modalidadeNome:item.modalidade }],totalPaginas:3 }));
  } });
  const result = await pncp.fetchLatest({ page:2,dataInicial:'2026-09-01',dataFinal:'2026-09-02' });
  assert.deepEqual(result.items,[item]);
  assert.equal(result.hasMore,true);
  const compras = createComprasnetSource({ fetchImpl: async url => {
    assert.equal(url.searchParams.get('codigoModalidade'),'5');
    return new Response(JSON.stringify({ resultado:[{ numeroControlePNCP:item.id,objetoCompra:item.objeto,dataAberturaPropostaPncp:item.dataAbertura,unidadeOrgaoNomeUnidade:item.unidadeGestora,modalidadeNome:item.modalidade }],totalPaginas:1 }));
  } });
  assert.deepEqual((await compras.fetchLatest()).items,[item]);
  assert.deepEqual((await createPncpSource({fetchImpl:async () => new Response(null,{status:204})}).fetchLatest()).items,[]);
  await assert.rejects(createPncpSource({fetchImpl:async () => new Response('{}')}).fetchLatest(),/Payload inválido/);
});

test('fluxo HTTP: interesses, correlação, status, preferências, permissões e isolamento', async () => {
  const db = new PGlite();
  for (const migration of await readMigrations()) await db.exec(migration.sql);
  const database = { query:(sql,values) => db.query(sql,values),connect:async () => ({query:(sql,values)=>db.query(sql,values),release(){}}) };
  const app = createApp({config,database,logger});
  const a = request.agent(app), b = request.agent(app), member = request.agent(app);
  async function register(agent,email,cnpj) {
    const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
    return (await agent.post('/api/auth/register').set('X-CSRF-Token',token).send({razao_social:'Empresa',cnpj,email_empresa:email,nome:'Gestor',email,senha:'Senha-teste-segura-2026!'}).expect(201)).body;
  }
  try {
    await request(app).get('/api/interesses').expect(401);
    const first = await register(a,'a@example.test','11222333000181');
    const second = await register(b,'b@example.test','11444777000161');
    const data = {titulo:'Informática',palavras:'notebook, computador',ativo:true};
    await a.post('/api/interesses').send(data).expect(403);
    await a.post('/api/interesses').set('X-CSRF-Token',first.csrfToken).send({...data,empresa_id:second.company.id}).expect(422);
    await a.post('/api/interesses').set('X-CSRF-Token',first.csrfToken).send({...data,palavras:'ti'}).expect(422);
    const interest = (await a.post('/api/interesses').set('X-CSRF-Token',first.csrfToken).send(data).expect(201)).body.interest;
    assert.equal((await b.get('/api/interesses').expect(200)).body.interests.length,0);
    await b.patch('/api/interesses/'+interest.id).set('X-CSRF-Token',second.csrfToken).send(data).expect(404);
    await persistPncpItems(database,[item]);
    await correlateOpportunities(database);
    const opportunities = (await a.get('/api/oportunidades').expect(200)).body;
    assert.equal(opportunities.total,1);
    const id = opportunities.items[0].match_id;
    assert.equal((await b.get('/api/oportunidades?empresa_id='+first.company.id).expect(200)).body.total,0);
    await b.patch('/api/oportunidades/'+id).set('X-CSRF-Token',second.csrfToken).send({status:'aceito'}).expect(404);
    await a.patch('/api/oportunidades/'+id).set('X-CSRF-Token',first.csrfToken).send({status:'aceito'}).expect(200);
    assert.equal((await a.get('/api/oportunidades?status=novo').expect(200)).body.total,0);
    await a.get('/api/oportunidades?score=101').expect(422);
    for (const path of ['/conta','/interesses','/oportunidades']) await a.get(path).expect(200);
    await a.get('/admin/operacao').expect(403);
    await a.post('/api/conta/alertas').set('X-CSRF-Token',first.csrfToken).send({alertas_email:true}).expect(200);
    const whatsapp={whatsapp_numero:'(84) 99999-9999',alertas_whatsapp:true,confirmar_whatsapp:true};
    await a.post('/api/conta/whatsapp').send(whatsapp).expect(403);
    await a.post('/api/conta/whatsapp').set('X-CSRF-Token',first.csrfToken).send({...whatsapp,confirmar_whatsapp:false}).expect(422);
    await a.post('/api/conta/whatsapp').set('X-CSRF-Token',first.csrfToken).send({...whatsapp,empresa_id:second.company.id}).expect(422);
    await a.post('/api/conta/whatsapp').set('X-CSRF-Token',first.csrfToken).send(whatsapp).expect(200);
    const preferences=(await db.query('SELECT whatsapp_numero,alertas_whatsapp FROM usuarios WHERE id=$1',[first.user.id])).rows[0];
    assert.deepEqual(preferences,{whatsapp_numero:'+5584999999999',alertas_whatsapp:true});
    assert.equal((await db.query('SELECT alertas_whatsapp FROM usuarios WHERE id=$1',[second.user.id])).rows[0].alertas_whatsapp,false);
    const whatsappPage=await a.get('/conta').expect(200);
    assert.match(whatsappPage.text,/Salvar WhatsApp/);
    await a.post('/api/conta/whatsapp').set('X-CSRF-Token',first.csrfToken).send({...whatsapp,alertas_whatsapp:false,confirmar_whatsapp:false}).expect(200);
    assert.equal((await db.query('SELECT alertas_email FROM usuarios WHERE id=$1',[first.user.id])).rows[0].alertas_email,true);
    await a.post('/api/usuarios').set('X-CSRF-Token',first.csrfToken).send({nome:'Leitor',email:'reader@example.test',senha:'Senha-teste-segura-2026!',tipo:'usuario'}).expect(201);
    const token = (await member.get('/api/auth/csrf')).body.csrfToken;
    const login = (await member.post('/api/auth/login').set('X-CSRF-Token',token).send({email:'reader@example.test',senha:'Senha-teste-segura-2026!'}).expect(200)).body;
    await member.get('/interesses').expect(200);
    await member.post('/api/conta/whatsapp').set('X-CSRF-Token',login.csrfToken).send(whatsapp).expect(403);
    await member.post('/api/interesses').set('X-CSRF-Token',login.csrfToken).send(data).expect(403);
    await member.patch('/api/oportunidades/'+id).set('X-CSRF-Token',login.csrfToken).send({status:'recusado'}).expect(403);
    await a.patch('/api/interesses/'+interest.id).set('X-CSRF-Token',first.csrfToken).send({...data,ativo:false}).expect(200);
    assert.equal((await a.get('/api/oportunidades').expect(200)).body.total,0);
    await a.patch('/api/interesses/'+interest.id).set('X-CSRF-Token',first.csrfToken).send({...data,palavras:'ambulância'}).expect(200);
    await correlateOpportunities(database);
    assert.equal((await a.get('/api/oportunidades').expect(200)).body.total,0);
    assert.equal((await db.query('SELECT status FROM matches WHERE id=$1',[id])).rows[0].status,'aceito');
    await db.query("UPDATE usuarios SET tipo='admin' WHERE id=$1",[first.user.id]);
    await a.get('/admin/operacao').expect(200);
    await a.post('/admin/operacao/sincronizar').set('X-CSRF-Token',first.csrfToken).send({}).expect(303);
  } finally { await app.locals.sessionStore.close(); await db.close(); }
});

test('worker mantém cursor, isola falhas, deduplica fontes, cria matches e não repete alertas enviados', async () => {
  const db = new PGlite();
  for (const migration of await readMigrations()) await db.exec(migration.sql);
  // PGlite has no session advisory locks; PostgreSQL lock behavior is checked separately.
  const query = (sql,values) => sql.includes('pg_try_advisory_lock') ? Promise.resolve({rows:[{locked:true}]}) : sql.includes('pg_advisory_unlock') ? Promise.resolve({rows:[]}) : db.query(sql,values);
  const database = {query,connect:async()=>({query,release(){}})};
  await db.exec(`INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Empresa','11222333000181','a@example.test');
    INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,alertas_email) VALUES (1,'Gestor','a@example.test','$2b$12$' || repeat('x',53),'gestor',true);
    INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']);`);
  let broken = true, sends = 0, emailBroken = false;
  const seen = [];
  const registry = createSourceRegistry({
    pncp:{fetchLatest:async ({page})=>{seen.push(page);return {items:[item],hasMore:page===1};}},
    comprasnet:{fetchLatest:async()=>{if(broken) throw new Error('offline');return {items:[{...item,id:'outra-origem'}],hasMore:false};}}
  });
  const emailService = createEmailService({transport:{sendMail:async()=>{if(emailBroken) throw new Error('SMTP indisponível');sends++;return {messageId:'test'};}},from:'alerts@example.test'});
  const worker = createOperationsService({database,config:{...config,EMAIL_ENABLED:'true'},logger,registry,emailService});
  try {
    const pending = worker.runOnce();
    assert.equal(worker.runOnce(),pending);
    await pending;
    assert.equal((await db.query("SELECT cursor FROM tarefas WHERE nome='sync:pncp:6'")).rows[0].cursor.page,2);
    assert.equal((await db.query("SELECT estado FROM tarefas WHERE nome='sync:comprasnet:5'")).rows[0].estado,'falhou');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM matches')).rows[0].n,1);
    broken = false;
    await db.exec('UPDATE tarefas SET proxima_execucao=now()');
    await worker.runOnce();
    assert.deepEqual(seen,[1,2]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM licitacoes_pncp')).rows[0].n,1);
    assert.equal(sends,1);
    await db.exec('UPDATE tarefas SET proxima_execucao=now()');
    await worker.runOnce();
    assert.equal(sends,1);
    assert.equal((await db.query('SELECT status FROM alertas')).rows[0].status,'enviado');
    await db.exec("UPDATE alertas SET status='pendente',tentativas=0; UPDATE usuarios SET alertas_email=false; UPDATE tarefas SET proxima_execucao=now()");
    await worker.runOnce();
    assert.equal(sends,1);
    emailBroken = true;
    await db.exec("UPDATE usuarios SET alertas_email=true; UPDATE tarefas SET proxima_execucao=now(); UPDATE alertas SET proxima_tentativa=now()");
    await worker.runOnce();
    const failedAttempt = (await db.query('SELECT status,tentativas,proxima_tentativa>now() AS delayed FROM alertas')).rows[0];
    assert.deepEqual(failedAttempt,{status:'pendente',tentativas:1,delayed:true});
    await db.exec("UPDATE tarefas SET proxima_execucao=now(); UPDATE alertas SET tentativas=4,proxima_tentativa=now()");
    await worker.runOnce();
    assert.equal((await db.query('SELECT status FROM alertas')).rows[0].status,'falhou');
  } finally { await worker.stop();await db.close(); }
});

test('cron impede sobreposição e continua após falha; email escapa conteúdo e valida score', async () => {
  let release, calls = 0;
  const cron = createCronService({now:()=>0});
  cron.register('slow',{intervalMs:1,run:async()=>{calls++;await new Promise(resolve=>{release=resolve;});}});
  cron.register('broken',{intervalMs:1,run:async()=>{throw new Error('offline');}});
  cron.register('next',{intervalMs:1,run:async()=>42});
  const pending = cron.runDue();
  await cron.runDue();
  release();
  await pending;
  assert.equal(calls,1);
  assert.equal(cron.getJob('next').nextRunAt,1);
  const email = createEmailService({from:'alerts@example.test',transport:{sendMail:async p=>p}});
  const payload = {to:'a@example.test',score:80,customer:'<img src=x>',interestName:'<b>Compra</b>',item:{objeto:'<script>alert(1)</script>'}};
  const result = await email.sendMatchAlert(payload);
  assert.ok(!result.html.includes('<script>'));
  assert.ok(result.html.includes('&lt;script&gt;'));
  for (const score of [Infinity,NaN,-1,101]) await assert.rejects(email.sendMatchAlert({...payload,score}));
});
