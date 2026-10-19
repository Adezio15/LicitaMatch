import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { interestSchema, opportunityService } from '../src/services/opportunityService.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { states } from '../src/utils/validation.js';
const logger={info(){},warn(){},error(){}};
const input={titulo:'Notebooks',palavras:'notebook',ativo:true};
test('estados por interesse validam formulário, múltipla seleção e rejeitam UFs inválidas',async()=>{
 assert.deepEqual(interestSchema.parse({...input,estados_alertas:['','RN','PB','RN']}).estados_alertas,['RN','PB']);
 assert.deepEqual(interestSchema.parse({...input,estados_alertas:''}).estados_alertas,[]);
 assert.deepEqual(interestSchema.parse({...input,estados_alertas:'SP'}).estados_alertas,['SP']);
 assert.throws(()=>interestSchema.parse({...input,estados_alertas:['XX']}));
 const html=await ejs.renderFile(new URL('../src/views/partials/interestAlertStates.ejs',import.meta.url).pathname,{states,selectedStates:['RN','PB']});
 assert.match(html,/Escolher estados \(RN, PB\)/);
 assert.match(html,/value="RN" checked/);assert.match(html,/value="PB" checked/);
 assert.equal((html.match(/type="checkbox"/g)||[]).length,27);
});
test('preferência persiste por interesse e filtra e-mail e WhatsApp sem mudar os matches',async()=>{
 const db=new PGlite();let worker;
 try{
  for(const migration of await readMigrations())await db.exec(migration.sql);
  await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','11222333000181','test@example.test','premium');
   INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,alertas_whatsapp,whatsapp_numero,whatsapp_consentimento_em)
   VALUES (1,'Gestor','test@example.test','$2b$12$'||repeat('x',53),'gestor',true,'+5584999999999',clock_timestamp());
   INSERT INTO whatsapp_inbound (mensagem_id,numero) VALUES ('test-inbound','+5584999999999');`);
  const service=opportunityService(db);
  const rn=await service.saveInterest(1,interestSchema.parse({...input,estados_alertas:['RN']}));
  const pb=await service.saveInterest(1,interestSchema.parse({...input,titulo:'Computadores',estados_alertas:['PB']}));
  assert.deepEqual((await service.saveInterest(1,interestSchema.parse(input),rn.id)).estados_alertas,['RN']);
  const sent={email:[],whatsapp:[]};
  for(const uf of ['RN','PB','SP',null])await db.query(`INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,uf,url_fonte)
   VALUES ($1,$2,now(),'Secretaria','Pregão Eletrônico',$3,'https://pncp.gov.br/app/editais/fixture')`,['states-'+uf,'Compra de notebook '+uf,uf]);
  const query=(sql,values)=>sql.includes('pg_try_advisory_lock')?Promise.resolve({rows:[{locked:true}]}):sql.includes('pg_advisory_unlock')?Promise.resolve({rows:[]}):db.query(sql,values);
  const provider=channel=>({sendMatchAlert:async payload=>{sent[channel].push(payload.item.objeto);return {accepted:true,messageId:'SM'+'a'.repeat(32)};}});
  worker=createOperationsService({database:{query,connect:async()=>({query,release(){}})},
   config:{EMAIL_ENABLED:'true',WHATSAPP_ENABLED:'true',WHATSAPP_MODE:'sandbox',WHATSAPP_SANDBOX_NUMBERS:'+5584999999999',SYNC_ENABLED:'false'},
   registry:createSourceRegistry(),logger,emailService:provider('email'),whatsappService:provider('whatsapp')});
  await worker.runOnce();
  for(const channel of ['email','whatsapp'])assert.deepEqual(sent[channel].sort(),['Compra de notebook PB','Compra de notebook RN']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM matches WHERE score=100')).rows[0].n,8);
  // Clearing the selection restores all states, including opportunities without a known UF.
  assert.deepEqual((await service.saveInterest(1,interestSchema.parse({...input,estados_alertas:''}),rn.id)).estados_alertas,[]);
  await db.exec("UPDATE tarefas SET proxima_execucao=now() WHERE nome LIKE 'alertas%'");
  await worker.runOnce();
  for(const channel of ['email','whatsapp'])assert.deepEqual(sent[channel].sort(),['Compra de notebook PB','Compra de notebook RN','Compra de notebook SP','Compra de notebook null']);
  assert.deepEqual((await service.interests(1)).find(i=>i.id===pb.id).estados_alertas,['PB']);
 }finally{await worker?.stop();await db.close();}
});
