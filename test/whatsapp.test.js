import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createWhatsAppService,normalizeWhatsAppNumber } from '../src/services/whatsappService.js';
import { createEmailService } from '../src/services/emailService.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { readMigrations } from '../src/services/migrationService.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';

const config = {WHATSAPP_ENABLED:'true',WHATSAPP_ACCESS_TOKEN:'synthetic-test-token',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_API_VERSION:'v23.0',WHATSAPP_TEMPLATE_NAME:'licitamatch_oportunidade',WHATSAPP_TEMPLATE_LANGUAGE:'pt_BR'};
const payload = {to:'+5584999999999',customer:'Empresa teste',interestName:'Notebooks',score:85,item:{objeto:'Aquisição de notebooks',modalidade:'Pregão',unidadeGestora:'Secretaria de Educação'}};

test('WhatsApp normaliza celular e envia template oficial com o mesmo resumo do email',async()=>{
  assert.equal(normalizeWhatsAppNumber('(84) 99999-9999'),payload.to);
  assert.equal(normalizeWhatsAppNumber('+55 (84) 99999-9999'),payload.to);
  for(const value of ['abc84999999999','849999999','+15555555555','00000000000']) assert.throws(()=>normalizeWhatsAppNumber(value));
  let body;
  const whatsapp = createWhatsAppService({config,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://graph.facebook.com/v23.0/123456/messages');
    assert.equal(options.headers.Authorization,'Bearer synthetic-test-token');
    assert.equal(options.redirect,'error');
    body=JSON.parse(options.body);
    return new Response(JSON.stringify({messages:[{id:'wamid.test'}]}));
  }});
  const result=await whatsapp.sendMatchAlert(payload);
  assert.deepEqual(result,{accepted:true,messageId:'wamid.test'});
  assert.equal(body.to,'5584999999999');
  assert.equal(body.type,'template');
  assert.equal(body.template.language.code,'pt_BR');
  assert.deepEqual(body.template.components[0].parameters.map(p=>p.text),['Empresa teste','Notebooks','85','Pregão','Secretaria de Educação','Aquisição de notebooks']);
  const email=createEmailService({from:'alerts@example.test',transport:{sendMail:async()=>({})}});
  const long={...payload,item:{...payload.item,objeto:'Compra '.repeat(300)}};
  await whatsapp.sendMatchAlert(long);
  const mail=await email.sendMatchAlert({...long,to:'owner@example.test'});
  for(const parameter of body.template.components[0].parameters) assert.ok(mail.message.text.includes(parameter.text));
  assert.ok(body.template.components[0].parameters[5].text.endsWith('…'));
});

test('WhatsApp não trata falha ou HTTP 200 sem ID como enviado e não expõe dados do provedor',async()=>{
  for(const response of [new Response(JSON.stringify({error:{message:'synthetic-test-token +5584999999999'}}),{status:400}),new Response('{}'),new Response('invalid')]) {
    const service=createWhatsAppService({config,fetchImpl:async()=>response});
    await assert.rejects(service.sendMatchAlert(payload),error=>!error.message.includes('synthetic-test-token')&&!error.message.includes('5584999999999'));
  }
  const offline=createWhatsAppService({config,fetchImpl:async()=>{throw new Error('synthetic-test-token');}});
  await assert.rejects(offline.sendMatchAlert(payload),/Não foi possível conectar/);
});

test('configuração WhatsApp desativada é opcional e ativação exige credenciais e template',()=>{
  const base={DATABASE_URL:'postgresql://test:test@localhost/test',SESSION_SECRET:'only-automated-testing-'.repeat(3)};
  assert.equal(parseEnv(base).WHATSAPP_ENABLED,'false');
  assert.throws(()=>parseEnv({...base,WHATSAPP_ENABLED:'true'}),error=>error.fields.includes('WHATSAPP_ACCESS_TOKEN')&&!error.message.includes('synthetic-test-token'));
  assert.equal(parseEnv({...base,...config}).WHATSAPP_ENABLED,'true');
  assert.throws(()=>parseEnv({...base,...config,WHATSAPP_PHONE_NUMBER_ID:'../messages'}));
});

test('fila envia por canal, isola falhas, respeita responsáveis e cancelamento, preserva histórico de e-mail',async()=>{
  const db=new PGlite();
  const migrations=await readMigrations();
  const query=(sql,values)=>sql.includes('pg_try_advisory_lock')?Promise.resolve({rows:[{locked:true}]}):sql.includes('pg_advisory_unlock')?Promise.resolve({rows:[]}):db.query(sql,values);
  const database={query,connect:async()=>({query,release(){}})};
  let worker;
  try{
    for(const migration of migrations.slice(0,-1)) await db.exec(migration.sql);
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Empresa A','11222333000181','a@example.test'),('Empresa B','11444777000161','b@example.test');
      INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,alertas_email) VALUES
      (1,'Responsável A','a@example.test','$2b$12$'||repeat('x',53),'gestor',true),
      (2,'Responsável B','b@example.test','$2b$12$'||repeat('x',53),'gestor',true),
      (1,'Leitor','reader@example.test','$2b$12$'||repeat('x',53),'usuario',false);
      INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']);
      INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora) VALUES ('WA-1','Compra de notebooks',now(),'Secretaria');
      INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,1,1,100);
      INSERT INTO alertas (match_id,usuario_id,status) VALUES (1,1,'enviado');`);
    await db.exec(migrations.at(-1).sql);
    assert.equal((await db.query('SELECT canal FROM alertas')).rows[0].canal,'email');
    await db.exec(`UPDATE usuarios SET whatsapp_numero='+5584999999999',alertas_whatsapp=true,whatsapp_consentimento_em=now();`);
    let emailCalls=0,whatsappCalls=0,fail=true;
    worker=createOperationsService({database,config:{...config,EMAIL_ENABLED:'true',ALERT_MIN_SCORE:70},logger:createLogger('silent'),registry:createSourceRegistry(),
      emailService:{sendMatchAlert:async()=>{emailCalls++;return {messageId:'email-id'};}},
      whatsappService:{sendMatchAlert:async(data)=>{whatsappCalls++;assert.equal(data.customer,'Empresa A');if(fail)throw new Error('offline');return {accepted:true,messageId:'wamid.queue'};}}
    });
    await worker.runOnce();
    assert.equal(emailCalls,0);
    assert.equal(whatsappCalls,1);
    assert.deepEqual((await db.query('SELECT canal,status,tentativas FROM alertas ORDER BY id')).rows,[{canal:'email',status:'enviado',tentativas:0},{canal:'whatsapp',status:'pendente',tentativas:1}]);
    fail=false;
    await db.exec('UPDATE tarefas SET proxima_execucao=now(); UPDATE alertas SET proxima_tentativa=now()');
    await worker.runOnce();
    assert.equal(emailCalls,0);
    assert.equal(whatsappCalls,2);
    assert.equal((await db.query("SELECT provedor_mensagem_id FROM alertas WHERE canal='whatsapp'")).rows[0].provedor_mensagem_id,'wamid.queue');
    await db.exec("UPDATE tarefas SET proxima_execucao=now(); UPDATE alertas SET status='pendente',proxima_tentativa=now() WHERE canal='whatsapp'; UPDATE usuarios SET alertas_whatsapp=false WHERE id=1");
    await worker.runOnce();
    assert.equal(whatsappCalls,2);
    await db.exec("UPDATE tarefas SET proxima_execucao=now(); UPDATE usuarios SET alertas_whatsapp=true,tipo='usuario' WHERE id=1");
    await worker.runOnce();
    assert.equal(whatsappCalls,2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM alertas')).rows[0].n,2);
    await worker.stop();
    await db.exec("UPDATE tarefas SET proxima_execucao=now(); UPDATE usuarios SET tipo='gestor',alertas_email=false WHERE id=1");
    worker=createOperationsService({database,config:{...config,EMAIL_ENABLED:'false',ALERT_MIN_SCORE:70},logger:createLogger('silent'),registry:createSourceRegistry(),whatsappService:{sendMatchAlert:async()=>{whatsappCalls++;return {messageId:'wamid.only'};}}});
    await worker.runOnce();
    assert.equal(whatsappCalls,3);
    assert.equal(emailCalls,0);
  }finally{await worker?.stop();await db.close();}
});
