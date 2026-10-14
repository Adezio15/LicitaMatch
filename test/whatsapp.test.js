import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import twilio from 'twilio';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { createWhatsAppService, normalizeWhatsAppNumber } from '../src/services/whatsappService.js';
import { sendWhatsAppAlerts } from '../src/services/whatsappAlertsService.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { parseEnv } from '../src/config/env.js';
import { readMigrations } from '../src/services/migrationService.js';
import { createLogger } from '../src/utils/logger.js';

const logger=createLogger('silent');
const sid='SM'+'1'.repeat(32);
const config={TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-token',
 TWILIO_WHATSAPP_FROM:'whatsapp:+14155238886',WHATSAPP_ENABLED:'true',WHATSAPP_MODE:'sandbox',
 WHATSAPP_SANDBOX_NUMBERS:'+5584999999999',WHATSAPP_WEBHOOK_URL:'https://licitamatch.online/api/whatsapp/webhook'};
const base={DATABASE_URL:'postgresql://test:test@localhost/test',NODE_ENV:'test',SESSION_SECRET:'only-automated-testing-'.repeat(3)};
const payload={to:'+5584999999999',customer:'Empresa',interestName:'Notebooks',score:67,lastInboundAt:new Date(),
 item:{objeto:'Compra de notebooks',unidadeGestora:'Secretaria',municipio:'Natal',uf:'RN',urlFonte:'https://pncp.gov.br/app/editais/123'}};
async function fixture() {
 const db=new PGlite();
 for(const migration of await readMigrations()) await db.exec(migration.sql);
 await db.exec("INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','11222333000181','a@example.test','premium'); INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em) VALUES (1,'Gestor','a@example.test','$2b$12$'||repeat('x',53),'gestor','+5584999999999',true,now()); INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']); INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,cidade,uf,url_fonte) VALUES ('WA-1','Compra de notebooks',now(),'Secretaria','Pregão Eletrônico','Natal','RN','https://pncp.gov.br/app/editais/123'); INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,1,1,67);");
 const query=(sql,values)=>sql.includes('pg_try_advisory_lock')?Promise.resolve({rows:[{locked:true}]}):sql.includes('pg_advisory_unlock')?Promise.resolve({rows:[]}):db.query(sql,values);
 return {db,database:{query,connect:async()=>({query,release(){}})}};
}
test('configuração é explícita e produção exige aprovação e template',()=>{
 assert.equal(parseEnv({...base,...config,WHATSAPP_ENABLED:undefined}).WHATSAPP_ENABLED,'false');
 assert.equal(parseEnv({...base,...config}).WHATSAPP_MODE,'sandbox');
 assert.throws(()=>parseEnv({...base,WHATSAPP_ENABLED:'true'}),/TWILIO_ACCOUNT_SID/);
 assert.throws(()=>parseEnv({...base,...config,WHATSAPP_MODE:'production'}),/PRODUCTION_NOT_READY/);
 assert.throws(()=>parseEnv({...base,WHATSAPP_WEBHOOK_URL:'http://licitamatch.online/api/whatsapp/webhook'}));
 assert.throws(()=>parseEnv({...base,WHATSAPP_WEBHOOK_URL:'invalid'}));
 assert.throws(()=>parseEnv({...base,WHATSAPP_SANDBOX_NUMBERS:'invalid'}));
 assert.equal(parseEnv({...base,...config,WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)}).WHATSAPP_ENABLED,'true');
});
test('adaptador Twilio usa janela ativa no Sandbox e ContentSid em produção',async()=>{
 assert.equal(normalizeWhatsAppNumber('(84) 99999-9999'),payload.to);
 for(const number of ['abc84999999999','+15555555555','00000000000']) assert.throws(()=>normalizeWhatsAppNumber(number));
 let message,calls=0;
 const client={messages:{create:async data=>{calls++;message=data;return {sid};}}};
 const service=createWhatsAppService({config,client});
 assert.deepEqual(await service.sendMatchAlert(payload),{accepted:true,messageId:sid});
 for(const text of ['Compra de notebooks','Secretaria','Natal/RN','67%','https://pncp.gov.br/app/editais/123']) assert.ok(message.body.includes(text));
 await assert.rejects(service.sendMatchAlert({...payload,score:66}));
 await assert.rejects(service.sendMatchAlert({...payload,lastInboundAt:new Date(Date.now()-86400000)}));
 await assert.rejects(service.sendMatchAlert({...payload,lastInboundAt:undefined}));
 await assert.rejects(service.sendMatchAlert({...payload,to:'+5584999999998'}));
 await assert.rejects(createWhatsAppService({config:{...config,WHATSAPP_ENABLED:'false'},client}).sendMatchAlert(payload));
 assert.equal(calls,1);
 const production={...config,WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)};
 await createWhatsAppService({config:production,client}).sendMatchAlert({...payload,lastInboundAt:undefined});
 assert.equal(message.contentSid,production.TWILIO_WHATSAPP_CONTENT_SID);
 assert.equal(message.body,undefined);
 assert.deepEqual(JSON.parse(message.contentVariables),{'1':'Compra de notebooks','2':'Secretaria','3':'Natal','4':'RN','5':'67','6':payload.item.urlFonte});
 await assert.rejects(createWhatsAppService({config:{...production,WHATSAPP_PRODUCTION_READY:'false'},client}).sendMatchAlert(payload));
});
test('falhas Twilio não expõem credenciais nem interpretam falta de SID como aceitação',async()=>{
 for(const failure of [Object.assign(new Error('synthetic-token +5584999999999'),{status:400,code:63016}),new Error('synthetic-token')]) {
  const service=createWhatsAppService({config,client:{messages:{create:async()=>{throw failure;}}}});
  await assert.rejects(service.sendMatchAlert(payload),error=>{assert.ok(!error.message.includes('synthetic-token'));assert.ok(!error.message.includes('5584999999999'));assert.equal(error.definitive,failure.status===400);return true;});
 }
 await assert.rejects(createWhatsAppService({config,client:{messages:{create:async()=>({})}}}).sendMatchAlert(payload),/não confirmou/);
});
test('webhook real do createApp valida URL pública, assinatura, campos, autorização e replay',async()=>{
 const {db,database}=await fixture();
 const app=createApp({config:parseEnv({...base,...config,TRUST_PROXY_HOPS:1}),database,logger});
 const body={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+payload.to,MessageSid:sid,Body:'Olá',FutureParameter:'signed too'};
 const post=(data=body,signature=twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,data),path='/api/whatsapp/webhook')=>request(app).post(path).set('X-Twilio-Signature',signature).set('X-Forwarded-Proto','http').set('X-Forwarded-Host','attacker.test').type('form').send(data);
 try {
  await post(body,'').expect(403);
  await post(body,'bad-signature').expect(403);
  await post({...body,Body:'Alterada'},twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,body)).expect(403);
  await post(body,twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,'http://localhost/api/whatsapp/webhook',body)).expect(403);
  await post(body,undefined,'/api/whatsapp/webhook?extra=1').expect(403);
  await post({...body,AccountSid:'AC'+'b'.repeat(32)}).expect(403);
  await post({...body,To:'whatsapp:+14155238887'}).expect(403);
  await request(app).post('/api/whatsapp/webhook').send(body).expect(415);
  const response=await post().expect(200).expect('Content-Type',/xml/);
  assert.ok(response.text.includes('Olá! Bem-vindo ao LicitaMatch. Em breve você receberá informações sobre oportunidades de licitação.'));
  assert.equal(response.headers['set-cookie'],undefined);
  assert.ok(!(await post().expect(200)).text.includes('<Message>'));
  await db.exec('UPDATE usuarios SET alertas_whatsapp=false');
  assert.ok(!(await post({...body,MessageSid:'SM'+'2'.repeat(32)}).expect(200)).text.includes('<Message>'));
  await request(app).get('/api/empresa').expect(401);
 } finally {await app.locals.sessionStore.close();await db.close();}
});
test('webhook desativado, Sandbox não autorizado e falha SQL não enviam resposta',async()=>{
 const {db,database}=await fixture();
 const apps=[];
 const body={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+payload.to,MessageSid:sid,Body:'teste'};
 try {
  for(const overrides of [{WHATSAPP_ENABLED:'false'},{WHATSAPP_SANDBOX_NUMBERS:''}]) {
   const app=createApp({config:parseEnv({...base,...config,...overrides}),database,logger});apps.push(app);
   const result=await request(app).post('/api/whatsapp/webhook').type('form').set('X-Twilio-Signature',twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,body)).send(body).expect(200);
   assert.ok(!result.text.includes('<Message>'));
  }
  const app=createApp({config:parseEnv({...base,...config}),database:{...database,query:async()=>{throw new Error('private');}},logger});apps.push(app);
  await request(app).post('/api/whatsapp/webhook').type('form').set('X-Twilio-Signature',twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,body)).send(body).expect(503);
 } finally {for(const app of apps)await app.locals.sessionStore.close();await db.close();}
});
test('fila SQL aplica 67%, consentimento, planos, janela, deduplicação e isola e-mail',async()=>{
 const {db,database}=await fixture();
 let calls=0,fail=false;
 const service={sendMatchAlert:async data=>{calls++;assert.equal(data.score,67);assert.equal(data.item.municipio,'Natal');if(fail)throw new Error('timeout');return {accepted:true,messageId:sid};}};
 const run=()=>sendWhatsAppAlerts({client:database,config,service,logger});
 try {
  assert.equal((await run()).sent,0);
  await db.query('INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)',[sid,payload.to]);
  for(const change of ["UPDATE usuarios SET alertas_whatsapp=false","UPDATE usuarios SET alertas_whatsapp=true,whatsapp_numero='',whatsapp_consentimento_em=NULL","UPDATE usuarios SET whatsapp_numero='+5584999999999',whatsapp_consentimento_em=now(),tipo='usuario'","UPDATE usuarios SET tipo='gestor',ativo=false","UPDATE usuarios SET ativo=true; UPDATE empresas SET status='inativo'","UPDATE empresas SET status='ativo',plano='pro'","UPDATE empresas SET plano='start'","UPDATE empresas SET plano='premium'; UPDATE matches SET score=66"]) {
   await db.exec(change);assert.equal((await run()).sent,0);
  }
  await db.exec('UPDATE matches SET score=67');
  // Two interests matching the same procurement still yield one message.
  await db.exec("INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Computadores',ARRAY['notebook']); INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (2,1,1,67);");
  assert.equal((await run()).sent,1);assert.equal((await run()).sent,0);assert.equal(calls,1);
  assert.equal((await db.query('SELECT status,provedor_mensagem_id FROM alertas_empresa_whatsapp')).rows[0].provedor_mensagem_id,sid);
  await db.exec("INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,cidade,uf) VALUES ('WA-2','Compra',now(),'Secretaria','Pregão Eletrônico','Natal','RN'); INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,2,1,67);");
  fail=true;assert.equal((await run()).failed,1);await run();assert.equal(calls,2);
  assert.equal((await db.query('SELECT status FROM alertas_empresa_whatsapp WHERE licitacao_id=2')).rows[0].status,'incerto');
  // A stored email delivery is independent and remains untouched.
  await db.exec("INSERT INTO alertas (match_id,usuario_id,canal,status) VALUES (1,1,'email','enviado')");
  const worker=createOperationsService({database,config:{...config,EMAIL_ENABLED:'false',ALERT_MIN_SCORE:100},logger,registry:createSourceRegistry(),whatsappService:service});
  try {await worker.runOnce();assert.equal(calls,2);}finally{await worker.stop();}
  assert.equal((await db.query("SELECT status FROM alertas WHERE canal='email'")).rows[0].status,'enviado');
 } finally {await db.close();}
});

test('reservas concorrentes enviam uma única vez e revogação antes da reserva bloqueia envio',async()=>{
 const {db,database}=await fixture();
 let calls=0;
 const service={sendMatchAlert:async()=>{calls++;return {accepted:true,messageId:sid};}};
 const run=client=>sendWhatsAppAlerts({client,config,service,logger});
 try {
  await db.query('INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)',[sid,payload.to]);
  await Promise.all([run(database),run(database)]);
  assert.equal(calls,1);
  await db.exec('DELETE FROM alertas_empresa_whatsapp');
  const revoke={query:async(sql,values)=>{
   if(sql.startsWith('INSERT INTO alertas_empresa_whatsapp')) await db.exec('UPDATE usuarios SET alertas_whatsapp=false');
   return database.query(sql,values);
  }};
  assert.equal((await run(revoke)).sent,0);assert.equal(calls,1);
 }finally{await db.close();}
});
test('rejeição definitiva é registrada sem repetir e histórico anterior impede reenvio',async()=>{
 const {db,database}=await fixture();
 let calls=0;
 const service={sendMatchAlert:async()=>{calls++;throw Object.assign(new Error('rejeitado'),{definitive:true,providerCode:63016});}};
 try{
  await db.query('INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)',[sid,payload.to]);
  await sendWhatsAppAlerts({client:database,config,service,logger});
  assert.deepEqual((await db.query('SELECT status,erro_codigo FROM alertas_empresa_whatsapp')).rows,[{status:'falhou',erro_codigo:63016}]);
  await sendWhatsAppAlerts({client:database,config,service,logger});assert.equal(calls,1);
  await db.exec("DELETE FROM alertas_empresa_whatsapp; INSERT INTO alertas (match_id,usuario_id,canal,status,provedor_mensagem_id) VALUES (1,1,'whatsapp','enviado','legacy-id'),(1,1,'email','enviado','email-id'); DROP TABLE alertas_empresa_whatsapp; DROP TABLE whatsapp_inbound;");
  const migration=(await readMigrations()).find(m=>m.name==='017_twilio_whatsapp.sql');
  await db.exec(migration.sql);
  assert.deepEqual((await db.query('SELECT status,provedor_mensagem_id FROM alertas_empresa_whatsapp')).rows,[{status:'enviado',provedor_mensagem_id:'legacy-id'}]);
  await sendWhatsAppAlerts({client:database,config:{...config,WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)},service,logger});
  assert.equal(calls,1);
  assert.equal((await db.query("SELECT provedor_mensagem_id FROM alertas WHERE canal='email'")).rows[0].provedor_mensagem_id,'email-id');
 }finally{await db.close();}
});
