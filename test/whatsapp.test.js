import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { whatsappRoutes } from '../src/routes/whatsappRoutes.js';
import twilio from 'twilio';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { createWhatsAppService, normalizeWhatsAppNumber, normalizeWhatsAppSender } from '../src/services/whatsappService.js';
import { sendWhatsAppAlerts } from '../src/services/whatsappAlertsService.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { parseEnv } from '../src/config/env.js';
import { readMigrations } from '../src/services/migrationService.js';
import { createLogger } from '../src/utils/logger.js';

const logger=createLogger('silent');
const sid='SM'+'1'.repeat(32);
const config={TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-token',
 TWILIO_WHATSAPP_FROM:'whatsapp:+14155238886',WHATSAPP_ENABLED:'true',WHATSAPP_WEBHOOK_ENABLED:'true',WHATSAPP_MODE:'sandbox',
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
 assert.equal(parseEnv({...base,...config}).WHATSAPP_SANDBOX_TEST_ENABLED,'false');
 const controlled={...base,...config,WHATSAPP_ENABLED:'false',WHATSAPP_PRODUCTION_READY:'false',WHATSAPP_SANDBOX_TEST_ENABLED:'true'};
 assert.equal(parseEnv(controlled).WHATSAPP_ENABLED,'false');
 for(const overrides of [{WHATSAPP_ENABLED:'true'},{WHATSAPP_PRODUCTION_READY:'true'},{WHATSAPP_MODE:'production'}])
  assert.throws(()=>parseEnv({...controlled,...overrides}),/SANDBOX_TEST_REQUIRES_DISABLED_PRODUCTION/);
 assert.throws(()=>parseEnv({...controlled,TWILIO_AUTH_TOKEN:undefined}),/TWILIO_AUTH_TOKEN/);
 assert.equal(parseEnv({...base,...config}).WHATSAPP_MODE,'sandbox');
 assert.equal(parseEnv({...base,...config,WHATSAPP_WEBHOOK_ENABLED:undefined}).WHATSAPP_WEBHOOK_ENABLED,'false');
 assert.throws(()=>parseEnv({...base,WHATSAPP_WEBHOOK_ENABLED:'true'}),/TWILIO_ACCOUNT_SID/);
 assert.throws(()=>parseEnv({...base,...config,WHATSAPP_WEBHOOK_ENABLED:'invalid'}),/WHATSAPP_WEBHOOK_ENABLED/);
 const webhookOnly=parseEnv({...base,...config,WHATSAPP_ENABLED:'false'});
 assert.equal(webhookOnly.WHATSAPP_WEBHOOK_ENABLED,'true');
 assert.equal(webhookOnly.WHATSAPP_PRODUCTION_READY,'false');
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
test('Webhook independente responde e registra sem ativar alertas automáticos',async()=>{
 const {db,database}=await fixture();
 const webhookConfig=parseEnv({...base,...config,WHATSAPP_ENABLED:'false'});
 const app=createApp({config:webhookConfig,database,logger});
 const body={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+payload.to,MessageSid:sid,Body:'Olá'};
 const post=(data=body,signature=twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,data))=>request(app).post('/api/whatsapp/webhook').type('form').set('X-Twilio-Signature',signature).send(data);
 let calls=0;
 const service={sendMatchAlert:async()=>{calls++;throw new Error('Não deve enviar');}};
 const worker=createOperationsService({database,config:{...webhookConfig,EMAIL_ENABLED:'false',SYNC_ENABLED:'false'},logger,registry:createSourceRegistry(),whatsappService:service});
 try {
  await post(body,'invalid').expect(403);
  assert.ok((await post().expect(200)).text.includes('<Message>Olá! Bem-vindo ao LicitaMatch. Em breve você receberá informações sobre oportunidades de licitação.</Message>'));
  assert.equal((await db.query('SELECT mensagem_id,numero FROM whatsapp_inbound')).rows.length,1);
  assert.ok(!(await post().expect(200)).text.includes('<Message>'));
  assert.deepEqual(await sendWhatsAppAlerts({client:database,config:webhookConfig,service,logger}),{sent:0,failed:0});
  await worker.runOnce();
  assert.equal(calls,0);
  assert.equal((await db.query('SELECT * FROM alertas_empresa_whatsapp')).rows.length,0);
  const outsider={...body,From:'whatsapp:+5584999999998',MessageSid:'SM'+'2'.repeat(32)};
  assert.ok(!(await post(outsider).expect(200)).text.includes('<Message>'));
  await db.exec('UPDATE usuarios SET alertas_whatsapp=false,whatsapp_consentimento_em=NULL');
  assert.ok(!(await post({...body,MessageSid:'SM'+'3'.repeat(32)}).expect(200)).text.includes('<Message>'));
  assert.equal((await db.query('SELECT * FROM whatsapp_inbound')).rows.length,1);
 } finally {await worker.stop();await app.locals.sessionStore.close();await db.close();}
});
test('webhook desativado, Sandbox não autorizado e falha SQL não enviam resposta',async()=>{
 const {db,database}=await fixture();
 const apps=[];
 const body={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+payload.to,MessageSid:sid,Body:'teste'};
 try {
  for(const overrides of [{WHATSAPP_WEBHOOK_ENABLED:'false'},{WHATSAPP_WEBHOOK_ENABLED:undefined},{WHATSAPP_SANDBOX_NUMBERS:''}]) {
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
  await db.exec("DELETE FROM alertas_empresa_whatsapp; INSERT INTO alertas (match_id,usuario_id,canal,status,provedor_mensagem_id) VALUES (1,1,'whatsapp','enviado','legacy-id'),(1,1,'email','enviado','email-id'); DROP TABLE whatsapp_sandbox_test; DROP TABLE alertas_empresa_whatsapp; DROP TABLE whatsapp_inbound;");
  const migration=(await readMigrations()).find(m=>m.name==='017_twilio_whatsapp.sql');
  await db.exec(migration.sql);
  assert.deepEqual((await db.query('SELECT status,provedor_mensagem_id FROM alertas_empresa_whatsapp')).rows,[{status:'enviado',provedor_mensagem_id:'legacy-id'}]);
  await sendWhatsAppAlerts({client:database,config:{...config,WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)},service,logger});
  assert.equal(calls,1);
  assert.equal((await db.query("SELECT provedor_mensagem_id FROM alertas WHERE canal='email'")).rows[0].provedor_mensagem_id,'email-id');
 }finally{await db.close();}
});


test('diagnósticos do webhook distinguem rejeições sem expor dados sensíveis',async()=>{
 const logs=[];
 const audit=Object.fromEntries(['info','warn','error'].map(level=>[level,(data)=>logs.push({level,...data})]));
 const body={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+payload.to,MessageSid:sid,Body:'  Olá + &= % 😃\nmensagem privada  ',FutureParameter:'new + field'};
 let queries=0;
 const makeApp=(overrides={},rows=[{id:1}],fail=false)=>{
  const app=express();
  app.use((req,res,next)=>{req.id='generated-test-id';next();});
  app.use(express.urlencoded({extended:false}));
  app.use(whatsappRoutes({config:{...config,WHATSAPP_ENABLED:'false',...overrides},logger:audit,database:{query:async()=>{queries++;if(fail)throw new Error('private SQL token');return {rows};}}}));
  return app;
 };
 const post=(app,data=body,signature=twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,data),path='/api/whatsapp/webhook')=>request(app).post(path).set('X-Forwarded-Proto','http').set('X-Forwarded-Host','spoofed.example').set('X-Twilio-Signature',signature).type('form').send(data);
 const check=async(result,status,reason)=>{
  const response=await result.expect(status);
  assert.equal(logs.at(-1).reason,reason);
  assert.equal(logs.at(-1).status,status);
  assert.equal(logs.at(-1).requestId,'generated-test-id');
  return response;
 };
 const app=makeApp();
 await check(post(app,body,undefined,'/api/whatsapp/webhook?secret=private-query'),403,'public_url_mismatch');
 await check(post(app,body,''),403,'signature_missing');
 await check(post(app,body,'private-signature'),403,'signature_invalid');
 await check(post(app,body,twilio.getExpectedTwilioSignature('wrong-token',config.WHATSAPP_WEBHOOK_URL,body)),403,'signature_invalid');
 await check(post(app,body,twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL.replace('https:','http:'),body)),403,'signature_invalid');
 await check(post(app,{...body,Body:'changed'},twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,body)),403,'signature_invalid');
 await check(post(app,{...body,AccountSid:'AC'+'b'.repeat(32)}),403,'account_sid_mismatch');
 await check(post(app,{...body,To:'whatsapp:+14155238887'}),403,'recipient_mismatch');
 for(const From of ['whatsapp:+','whatsapp:+15555555555',['whatsapp:'+payload.to,'whatsapp:'+payload.to]])
  await check(post(app,{...body,From}),400,'sender_invalid');
 await check(post(app,{...body,MessageSid:[sid,sid]}),400,'message_sid_invalid');
 assert.equal(queries,0);
 assert.ok((await check(post(app),200,'welcome_replied')).text.includes('<Message>'));
 await check(post(makeApp({WHATSAPP_WEBHOOK_ENABLED:'false'})),200,'webhook_disabled');
 await check(post(makeApp({WHATSAPP_SANDBOX_NUMBERS:'+5584999999998'})),200,'sandbox_number_not_allowed');
 await check(post(makeApp({},[])),200,'sender_not_eligible');
 await check(post(makeApp({},[],true)),503,'database_failure');
 await check(post(makeApp({TWILIO_AUTH_TOKEN:undefined})),503,'auth_token_missing');
 await check(request(app).post('/api/whatsapp/webhook').send(body),415,'unsupported_content_type');
 const queryUrl=config.WHATSAPP_WEBHOOK_URL+'?key=a%2Bb&other=c%20d';
 await check(post(makeApp({WHATSAPP_WEBHOOK_URL:queryUrl}),body,twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,queryUrl,body),'/api/whatsapp/webhook?key=a%2Bb&other=c%20d'),200,'welcome_replied');
 const serialized=JSON.stringify(logs);
 for(const secret of [config.TWILIO_AUTH_TOKEN,config.TWILIO_ACCOUNT_SID,config.TWILIO_WHATSAPP_FROM,payload.to,sid,body.Body,body.FutureParameter,'private-signature','private-query','private SQL token','spoofed.example']) assert.ok(!serialized.includes(secret));
});


test('remetentes brasileiros preservam oito ou nove dígitos',()=>{
 for(const [address,canonical] of [
  ['whatsapp:+5584999999999','+5584999999999'],
  ['whatsapp:+5511987654321','+5511987654321'],
  ['whatsapp:+5521967654321','+5521967654321'],
  ['whatsapp:+558499999999','+558499999999'],
  ['whatsapp:+551187654321','+551187654321']
 ]) assert.equal(normalizeWhatsAppSender(address),canonical);
 for(const value of [undefined,null,[],['whatsapp:+5584999999999'],'whatsapp:+','whatsapp: 5584999999999',
  'whatsapp:%2B5584999999999','whatsapp:%252B5584999999999','whatsapp:+5584 99999-9999',
  ' whatsapp:+5584999999999','whatsapp:+5584999999999 ','whatsapp:++5584999999999',
  'whatsapp:+15555555555','whatsapp:+558433334444','whatsapp:+5509999999999',
  'whatsapp:+5584888888888','whatsapp:+5523999999999','whatsapp:+552399999999','whatsapp:+55849999999','whatsapp:+55849999999999'])
  assert.throws(()=>normalizeWhatsAppSender(value));
 assert.equal(normalizeWhatsAppNumber('+558499999999'),'+558499999999');
 assert.equal(normalizeWhatsAppNumber('(84) 9999-9999'),'+558499999999');
 assert.equal(normalizeWhatsAppNumber('(84) 99999-9999'),'+5584999999999');
});

test('formulário preserva + codificado, rejeita dupla codificação e valida assinatura antes de normalizar',async()=>{
 const app=express(),logs=[],lookups=[],parsed=[];
 app.use(express.urlencoded({extended:false}));
 app.use((req,res,next)=>{parsed.push(structuredClone(req.body));next();});
 const audit=Object.fromEntries(['info','warn','error'].map(level=>[level,data=>logs.push(data)]));
 app.use(whatsappRoutes({config:{...config,WHATSAPP_ENABLED:'false',WHATSAPP_SANDBOX_NUMBERS:'+5511987654321'},logger:audit,
  database:{query:async(sql,values)=>{lookups.push(values);return {rows:[{id:1}]};}}}));
 const baseBody={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,MessageSid:sid,Body:'Olá + %2B 😃'};
 const post=async(data,raw=new URLSearchParams(data).toString(),signed=data)=>{
  const before=lookups.length;
  const signature=twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,config.WHATSAPP_WEBHOOK_URL,signed);
  const result=await request(app).post('/api/whatsapp/webhook').type('form').set('X-Twilio-Signature',signature).send(raw);
  return {result,before,reason:logs.at(-1).reason};
 };
 for(const From of ['whatsapp:+5511987654321']) {
  const data={...baseBody,From};
  const {result}=await post(data);
  assert.equal(result.status,200);
  assert.ok(result.text.includes('<Message>'));
  assert.equal(parsed.at(-1).From,From);
  assert.equal(parsed.at(-1).Body,baseBody.Body);
  assert.equal(lookups.at(-2)[0],'+5511987654321');
 }
 const legacy={...baseBody,From:'whatsapp:+551187654321'};
 let outcome=await post(legacy,undefined,{...legacy,From:'whatsapp:+5511987654321'});
 assert.equal(outcome.result.status,403);assert.equal(outcome.reason,'signature_invalid');assert.equal(lookups.length,outcome.before);
 for(const From of ['whatsapp:%2B5511987654321','whatsapp:%252B5511987654321','whatsapp: 5511987654321','whatsapp:+551133334444']) {
  outcome=await post({...baseBody,From});
  assert.equal(outcome.result.status,400);assert.equal(outcome.reason,'sender_invalid');assert.equal(lookups.length,outcome.before);
 }
 const valid={...baseBody,From:'whatsapp:+5511987654321'};
 // A literal + represents a space in form encoding, never an international prefix.
 const literal=new URLSearchParams(valid).toString().replace('From=whatsapp%3A%2B','From=whatsapp%3A+');
 outcome=await post(valid,literal);
 assert.equal(parsed.at(-1).From,'whatsapp: 5511987654321');
 assert.equal(outcome.result.status,403);assert.equal(outcome.reason,'signature_invalid');
 const decodedSpace={...valid,From:'whatsapp: 5511987654321'};
 outcome=await post(decodedSpace,literal);
 assert.equal(outcome.result.status,400);assert.equal(outcome.reason,'sender_invalid');
 const duplicateRaw=new URLSearchParams(valid).toString()+'&From='+encodeURIComponent(valid.From);
 outcome=await post(valid,duplicateRaw,{...valid,From:[valid.From,valid.From]});
 assert.ok(Array.isArray(parsed.at(-1).From));
 assert.equal(outcome.result.status,400);assert.equal(outcome.reason,'sender_invalid');assert.equal(logs.at(-1).senderReason,'from_duplicated');assert.equal(lookups.length,outcome.before);
});


test('motivos de remetente inválido são códigos fixos sem número ou conteúdo',()=>{
 for(const [value,code] of [
  [undefined,'from_not_string'],[['whatsapp:+5584999999999'],'from_duplicated'],
  ['whatsapp: 5584999999999','from_prefix_invalid'],['whatsapp:+5584 999999999','from_characters_invalid'],
  ['whatsapp:+15555555555','from_country_invalid'],['whatsapp:+55849999999','from_length_invalid'],
  ['whatsapp:+5584888888888','from_mobile_format_invalid']
 ]) assert.throws(()=>normalizeWhatsAppSender(value),error=>error.code===code && !error.message.includes('5584'));
});


test('número com oito dígitos exige lista e cadastro exatos, consentimento e elegibilidade',async()=>{
 const {db,database}=await fixture();
 const short='+558499999999';
 const cfg=parseEnv({...base,...config,WHATSAPP_ENABLED:'false',WHATSAPP_SANDBOX_NUMBERS:short});
 const app=createApp({config:cfg,database,logger});
 const body={AccountSid:cfg.TWILIO_ACCOUNT_SID,To:cfg.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+short,MessageSid:sid,Body:'Olá'};
 const post=(data=body)=>request(app).post('/api/whatsapp/webhook').type('form').set('X-Twilio-Signature',twilio.getExpectedTwilioSignature(cfg.TWILIO_AUTH_TOKEN,cfg.WHATSAPP_WEBHOOK_URL,data)).send(data);
 try {
  // No inferred alias for the existing nine-digit registered number.
  assert.ok(!(await post().expect(200)).text.includes('<Message>'));
  await db.query('UPDATE usuarios SET whatsapp_numero=$1',[short]);
  assert.ok((await post().expect(200)).text.includes('<Message>'));
  assert.equal((await db.query('SELECT numero FROM whatsapp_inbound')).rows[0].numero,short);
  assert.ok(!(await post({...body,From:'whatsapp:'+payload.to,MessageSid:'SM'+'2'.repeat(32)}).expect(200)).text.includes('<Message>'));
  const sent=[];
  const service=createWhatsAppService({config:{...cfg,WHATSAPP_ENABLED:'true'},client:{messages:{create:async data=>{sent.push(data);return {sid};}}}});
  await service.sendMatchAlert({...payload,to:short});
  assert.equal(sent[0].to,'whatsapp:'+short);
  await assert.rejects(createWhatsAppService({config:cfg,client:{messages:{create:async()=>{throw new Error('must not send');}}}}).sendMatchAlert({...payload,to:short}),/desativado/);
  for(const change of ["UPDATE usuarios SET alertas_whatsapp=false,whatsapp_consentimento_em=NULL", "UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=now(),ativo=false", "UPDATE usuarios SET ativo=true; UPDATE empresas SET status='inativo'", "UPDATE empresas SET status='ativo',plano='pro'"]) {
   await db.exec(change);
   assert.ok(!(await post({...body,MessageSid:'SM'+'3'.repeat(32)}).expect(200)).text.includes('<Message>'));
  }
  for(const invalid of ['+552399999999','+558433334444','+5584888888888']) {
   await assert.rejects(db.query('UPDATE usuarios SET whatsapp_numero=$1',[invalid]));
   assert.throws(()=>parseEnv({...base,...config,WHATSAPP_SANDBOX_NUMBERS:invalid}));
  }
 } finally {await app.locals.sessionStore.close();await db.close();}
});

test('teste administrativo exige confirmação, autorização e permite uma única tentativa',async()=>{
 const {runSandboxTest}=await import('../src/services/whatsappSandboxTestService.js');
 const {db}=await fixture();
 const cfg={...config,WHATSAPP_ENABLED:'false',WHATSAPP_PRODUCTION_READY:'false',WHATSAPP_SANDBOX_TEST_ENABLED:'true'};
 const options={empresaId:'1',usuarioId:'1'};
 let calls=0;
 const recipients=[];
 const provider={messages:{create:async message=>{calls++;recipients.push(message);return {sid};}}};
 try {
  await assert.rejects(runSandboxTest(db,cfg,options,provider),/24 horas/);
  await db.query('INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)',[sid,payload.to]);
  await db.exec("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em) VALUES (1,'Outro gestor','other@example.test','$2b$12$'||repeat('x',53),'gestor','+5584999999998',true,now()); INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ('SM'||repeat('2',32),'+5584999999998'); INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,cidade,uf,url_fonte) VALUES ('WA-OTHER','Outro objeto',now(),'Outro órgão','Pregão Eletrônico','Natal','RN','https://pncp.gov.br/app/editais/456'); INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,2,1,67);");
  const preview=await runSandboxTest(db,cfg,options,provider);
  assert.equal(calls,0);
  const byEmail={empresaId:'1',email:' A@EXAMPLE.TEST '};
  assert.equal((await runSandboxTest(db,cfg,byEmail,provider)).confirmation,preview.confirmation);
  await assert.rejects(runSandboxTest(db,cfg,{empresaId:'2',email:'a@example.test'},provider),/conta única/);
  await assert.rejects(runSandboxTest(db,cfg,{...options,email:'a@example.test'},provider),/exclusivamente/);
  await assert.rejects(runSandboxTest(db,cfg,{empresaId:'1',email:'invalid'},provider),/válido/);
  await assert.rejects(runSandboxTest(db,cfg,{...options,confirmation:'invalid'},provider),/Confirmação/);
  await assert.rejects(runSandboxTest(db,{...cfg,WHATSAPP_SANDBOX_TEST_ENABLED:'false'},{...options,confirmation:preview.confirmation},provider),/Ative/);
  await db.query('UPDATE usuarios SET alertas_whatsapp=false');
  await assert.rejects(runSandboxTest(db,cfg,{...options,confirmation:preview.confirmation},provider),/elegível/);
  await db.query('UPDATE usuarios SET alertas_whatsapp=true');
  assert.equal((await runSandboxTest(db,cfg,{...byEmail,confirmation:preview.confirmation},provider)).accepted,true);
  await assert.rejects(runSandboxTest(db,cfg,{...options,confirmation:preview.confirmation},provider));
  assert.equal(calls,1);
  assert.equal(recipients[0].to,'whatsapp:'+payload.to);
  for(const text of ['Secretaria','Compra de notebooks','Natal/RN','67%',payload.item.urlFonte]) assert.ok(recipients[0].body.includes(text));
  // Even another eligible opportunity/user in the allowlist cannot reserve a second test.
  await assert.rejects(runSandboxTest(db,cfg,{empresaId:'1',usuarioId:'2'} ,provider),/elegível/);
  const expanded={...cfg,WHATSAPP_SANDBOX_NUMBERS:cfg.WHATSAPP_SANDBOX_NUMBERS+',+5584999999998'};
  const other=await runSandboxTest(db,expanded,{empresaId:'1',usuarioId:'2'},provider);
  await assert.rejects(runSandboxTest(db,expanded,{empresaId:'1',usuarioId:'2',confirmation:other.confirmation},provider),/já reservado/);
  assert.equal(calls,1);
  assert.equal((await db.query('SELECT status FROM alertas_empresa_whatsapp')).rows[0].status,'enviado');
 } finally {await db.close();}
});

test('teste administrativo mantém reserva após rejeição, timeout e falha de persistência',async()=>{
 const {runSandboxTest}=await import('../src/services/whatsappSandboxTestService.js');
 const {db}=await fixture();
 const cfg={...config,WHATSAPP_ENABLED:'false',WHATSAPP_PRODUCTION_READY:'false',WHATSAPP_SANDBOX_TEST_ENABLED:'true'};
 const options={empresaId:'1',usuarioId:'1'};
 let calls=0;
 try {
  await db.query('INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ($1,$2)',[sid,payload.to]);
  for(const kind of ['rejeicao','timeout','persistencia']) {
   // Reset only this isolated in-memory fixture to exercise independent failure paths.
   await db.exec('DELETE FROM whatsapp_sandbox_test; DELETE FROM alertas_empresa_whatsapp;');
   const preview=await runSandboxTest(db,cfg,options);
   const provider={messages:{create:async()=>{
    calls++;
    if(kind==='rejeicao') throw Object.assign(new Error('private token'),{status:400,code:63016});
    if(kind==='timeout') throw new Error('private token');
    return {sid};
   }}};
   const client={query:(sql,values)=>{
    if(kind==='persistencia' && sql.startsWith("UPDATE alertas_empresa_whatsapp SET status='enviado'")) throw new Error('Persistence unavailable');
    return db.query(sql,values);
   }};
   await assert.rejects(runSandboxTest(client,cfg,{...options,confirmation:preview.confirmation},provider));
   const row=(await db.query('SELECT status,erro_codigo FROM alertas_empresa_whatsapp')).rows[0];
   assert.equal(row.status,{rejeicao:'falhou',timeout:'incerto',persistencia:'enviando'}[kind]);
   assert.equal(row.erro_codigo,kind==='rejeicao'?63016:null);
   assert.equal((await db.query('SELECT * FROM whatsapp_sandbox_test')).rows.length,1);
   const before=calls;
   await assert.rejects(runSandboxTest(db,cfg,{...options,confirmation:preview.confirmation},provider));
   assert.equal(calls,before);
  }
 } finally {await db.close();}
});
