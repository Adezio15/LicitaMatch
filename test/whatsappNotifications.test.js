import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { sendWhatsAppAlerts } from '../src/services/whatsappAlertsService.js';
import { whatsappRoutes } from '../src/routes/whatsappRoutes.js';
import { createWhatsAppService } from '../src/services/twilioWhatsAppService.js';
import { parseEnv } from '../src/config/env.js';
const sid='SM'+'a'.repeat(32),number='+5584999999999';
const config={WHATSAPP_ENABLED:'true',WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',
 TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32),TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic',
 TWILIO_WHATSAPP_FROM:'whatsapp:+14155238886',WHATSAPP_STATUS_CALLBACK_URL:'https://licitamatch.online/api/whatsapp/status',
 WHATSAPP_WEBHOOK_URL:'https://licitamatch.online/api/whatsapp/webhook'};
const logger={info(){},warn(){},error(){}};
async function fixture(){
 const db=new PGlite();for(const m of await readMigrations())await db.exec(m.sql);
 await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','11222333000181','a@example.test','premium');
 INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em)
 VALUES (1,'Gestor','a@example.test','$2b$12$'||repeat('x',53),'gestor','${number}',true,clock_timestamp());
 INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebook',ARRAY['notebook']);`);
 const calls=[];
 const run=(overrides={},client=db)=>sendWhatsAppAlerts({client,config:{...config,...overrides},logger,service:{sendMatchAlert:async p=>{calls.push(p);return {accepted:true,messageId:sid};}}});
 await run();
 const add=async code=>{
  const l=(await db.query(`INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,url_fonte)
   VALUES ($1,'Notebook',now(),'Secretaria','Pregão Eletrônico','https://pncp.gov.br/app/editais/123') RETURNING id`,[code])).rows[0].id;
  await db.query('INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,$1,1,80)',[l]);return l;
 };
 const app=express();app.use(express.urlencoded({extended:false}));app.use(whatsappRoutes({config:{...config,WHATSAPP_ENABLED:'false',WHATSAPP_WEBHOOK_ENABLED:'false'},database:db,logger}));
 const post=(path,data,signed=true)=>request(app).post(path).type('form').set('X-Twilio-Signature',signed?twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN,'https://licitamatch.online'+path,data):'invalid').send(data);
 return {db,run,add,calls,post};
}
test('limite persistente por usuário, custo, kill switch e deduplicação após troca de número',async()=>{
 const {db,run,add,calls}=await fixture();try{
  await add('one');await add('two');
  const results=await Promise.all([run({WHATSAPP_DAILY_LIMIT:1,WHATSAPP_ESTIMATED_UNIT_COST_BRL:0.15}),run({WHATSAPP_DAILY_LIMIT:1,WHATSAPP_ESTIMATED_UNIT_COST_BRL:0.15})]);
  assert.equal(results.reduce((n,r)=>n+r.sent,0),1);assert.equal(calls.length,1);
  assert.equal((await run({WHATSAPP_DAILY_LIMIT:0})).sent,0);
  await db.exec('UPDATE whatsapp_controle SET suspenso=true');
  assert.equal((await run()).sent,0);
  await db.exec('UPDATE whatsapp_controle SET suspenso=false');
  assert.equal((await run()).sent,1);
  const a=(await db.query('SELECT * FROM alertas_empresa_whatsapp ORDER BY id')).rows;
  assert.equal(a.length,2);assert.ok(a.some(r=>Number(r.custo_estimado_brl)===0.15));
  await db.exec("UPDATE usuarios SET whatsapp_numero='+5584999999998'");
  await db.query('UPDATE usuarios SET whatsapp_habilitado_em=clock_timestamp()-interval \'1 day\'');
  assert.equal((await run()).sent,0);
 }finally{await db.close();}
});
test('licitação antiga com match novo, gratuito, revogação e parada entre reserva e envio bloqueiam',async()=>{
 const {db,run,add,calls,post}=await fixture();try{
  const old=await add('old');await db.query("UPDATE licitacoes_pncp SET created_at=now()-interval '1 day' WHERE id=$1",[old]);
  assert.equal((await run()).sent,0);
  await db.exec("UPDATE empresas SET plano='sem_plano'");
  await add('free');assert.equal((await run()).sent,0);
  await db.exec("UPDATE empresas SET plano='premium'");assert.equal((await run()).sent,0);
  await add('cancel');
  const data={AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+number,MessageSid:sid,Body:'SAIR'};
  await post('/api/whatsapp/webhook',data).expect(200);
  assert.equal((await run()).sent,0);assert.equal((await db.query('SELECT alertas_whatsapp,whatsapp_consentimento_em FROM usuarios')).rows[0].whatsapp_consentimento_em,null);
  await db.exec('UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=clock_timestamp()');
  await add('kill');
  const client={query:async(sql,values)=>{const result=await db.query(sql,values);if(sql.startsWith('INSERT INTO alertas_empresa_whatsapp')) await db.exec('UPDATE whatsapp_controle SET suspenso=true');return result;}};
  assert.equal((await run({},client)).sent,0);assert.equal(calls.length,0);
 }finally{await db.close();}
});
test('callbacks assinados persistem antes do SID, deduplicam e rejeitam adulteração',async()=>{
 const {db,add,run,post}=await fixture();try{
  const event={AccountSid:config.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:'delivered'};
  await post('/api/whatsapp/status',event,false).expect(403);
  await post('/api/whatsapp/status',{...event,AccountSid:'AC'+'b'.repeat(32)}).expect(403);
  await post('/api/whatsapp/status',event).expect(204);await post('/api/whatsapp/status',event).expect(204);
  await post('/api/whatsapp/status',{...event,MessageStatus:'nonsense'}).expect(400);
  assert.equal((await db.query('SELECT * FROM whatsapp_status_eventos')).rows.length,1);
  await add('delivered');await run();
  assert.equal((await db.query('SELECT a.id FROM alertas_empresa_whatsapp a JOIN whatsapp_status_eventos w ON w.mensagem_id=a.provedor_mensagem_id')).rows.length,1);
 }finally{await db.close();}
});
test('nenhuma entrada gera menu ou resposta; cancelamento não depende de Premium ou flags',async()=>{
 const {db,post,run}=await fixture();try{
  await db.exec("UPDATE empresas SET plano='pro'");
  for(const Body of ['oi','menu','consultar','START','STOP']){
   const response=await post('/api/whatsapp/webhook',{AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+number,MessageSid:sid,Body}).expect(200);
   assert.ok(!response.text.includes('<Message>'));
  }
  assert.equal((await db.query('SELECT alertas_whatsapp FROM usuarios')).rows[0].alertas_whatsapp,false);
  assert.equal((await run()).sent,0);
  await db.exec('UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=clock_timestamp()');
  await post('/api/whatsapp/webhook',{AccountSid:config.TWILIO_ACCOUNT_SID,To:config.TWILIO_WHATSAPP_FROM,From:'whatsapp:'+number,MessageSid:sid,Body:'STOP'}).expect(200);
  assert.equal((await db.query('SELECT alertas_whatsapp FROM usuarios')).rows[0].alertas_whatsapp,true);
 }finally{await db.close();}
});
test('produção exige dados obrigatórios e usa exclusivamente template com quatro variáveis',async()=>{
 const calls=[],client={messages:{create:async m=>{calls.push(m);return {sid};}}};
 const service=createWhatsAppService({config,client});
 const payload={to:number,score:67,item:{objeto:'Objeto',unidadeGestora:'Órgão',urlFonte:'https://pncp.gov.br/app/editais/123'}};
 for(const field of ['objeto','unidadeGestora','urlFonte'])await assert.rejects(service.sendMatchAlert({...payload,item:{...payload.item,[field]:''}}));
 await assert.rejects(service.sendMatchAlert({...payload,item:{...payload.item,urlFonte:'https://?'}}));
 assert.equal(calls.length,0);await service.sendMatchAlert(payload);
 assert.equal(calls[0].body,undefined);assert.equal(calls[0].contentSid,config.TWILIO_WHATSAPP_CONTENT_SID);assert.equal(calls[0].statusCallback,config.WHATSAPP_STATUS_CALLBACK_URL);
 assert.deepEqual(JSON.parse(calls[0].contentVariables),{'1':'Objeto','2':'Órgão','3':'67','4':payload.item.urlFonte});
 const base={DATABASE_URL:'postgresql://test:test@localhost/test',SESSION_SECRET:'only-testing-secret-'.repeat(3)};
 for(const flag of ['WHATSAPP_BOT_ENABLED','WHATSAPP_BOT_OUTBOUND_ENABLED','WHATSAPP_HUMAN_OUTBOUND_ENABLED'])assert.throws(()=>parseEnv({...base,[flag]:'true'}));
 assert.equal(parseEnv(base).WHATSAPP_ENABLED,'false');assert.equal(parseEnv(base).WHATSAPP_PRODUCTION_READY,'false');
});
