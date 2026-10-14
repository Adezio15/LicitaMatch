import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { sendWhatsAppAlerts } from '../src/services/whatsappAlertsService.js';

const logger={info(){},error(){}};
const config={WHATSAPP_ENABLED:'true',WHATSAPP_MODE:'production',WHATSAPP_PRODUCTION_READY:'true',TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)};
const link='https://pncp.gov.br/edital/42';
async function fixture({existing=false}={}) {
 const db=new PGlite();
 const migrations=await readMigrations();
 for (const migration of migrations.filter(m=>!m.name.startsWith('020_'))) await db.exec(migration.sql);
 await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','12345678000199','x@example.test','premium');
 INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em)
 VALUES (1,'Gestor','x@example.test','$2b$12$'||repeat('x',53),'gestor','+5584999999999',true,now());
 INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebook',ARRAY['notebook']);`);
 if(existing) await addMatch(db,'historico');
 await db.exec(migrations.find(m=>m.name.startsWith('020_')).sql);
 const messages=[];
 const run=(client=db, overrides={})=>sendWhatsAppAlerts({client,config:{...config,...overrides},logger,service:{sendMatchAlert:async p=>{messages.push(p);return {accepted:true,messageId:'SM'+'1'.repeat(32)};}}});
 return {db,messages,run};
}
async function addMatch(db,code,{edital=link,fonte=null,score=67}={}) {
 const {rows}=await db.query(`INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,link_edital,url_fonte)
 VALUES ($1,'Notebook',now(),'Secretaria','Pregão Eletrônico',$2,$3) RETURNING id`,[code,edital,fonte]);
 return (await db.query('INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,$1,1,$2) RETURNING id',[rows[0].id,score])).rows[0].id;
}
const epoch=async db=>(await db.query('SELECT whatsapp_habilitado_em::text AS whatsapp_habilitado_em FROM usuarios WHERE id=1')).rows[0].whatsapp_habilitado_em;

test('primeira produção exclui estoque anterior; reinício mantém marco e só envia matches posteriores',async()=>{
 const {db,messages,run}=await fixture({existing:true});
 try {
  assert.ok(await epoch(db));
  await addMatch(db,'antes-da-producao');
  assert.deepEqual(await Promise.all([run(),run()]),[{sent:0,failed:0},{sent:0,failed:0}]);
  const cutoff=(await db.query('SELECT ativado_em::text AS ativado_em FROM whatsapp_ativacao_producao')).rows[0].ativado_em;
  const boundary=await addMatch(db,'fronteira-microssegundo');
  await db.query(`UPDATE matches SET created_at=(SELECT ativado_em-interval '1 microsecond'
    FROM whatsapp_ativacao_producao WHERE id=true) WHERE id=$1`,[boundary]);
  assert.equal((await run()).sent,0);
  await addMatch(db,'novo');
  assert.equal((await Promise.all([run(),run()])).reduce((n,result)=>n+result.sent,0),1);
  assert.equal((await run()).sent,0); assert.equal(messages.length,1);
  assert.equal((await db.query('SELECT ativado_em::text AS ativado_em FROM whatsapp_ativacao_producao')).rows[0].ativado_em,cutoff);
  await db.exec("UPDATE matches SET score=75 WHERE id=1");
  assert.equal((await run()).sent,0);
 }finally{await db.close();}
});

test('link é validado antes da reserva, edital tem prioridade e inválido usa fallback',async()=>{
 const {db,messages,run}=await fixture();
 try {
  await run();
  await addMatch(db,'edital',{fonte:'https://portal.gov.br/processo/42'});
  await addMatch(db,'fallback',{fonte:'https://portal.gov.br/processo/43'});
  await db.query("UPDATE licitacoes_pncp SET link_edital='https://?' WHERE codigo_externo='fallback'");
  await addMatch(db,'vazio',{edital:null});
  await addMatch(db,'invalido',{edital:'https://?'});
  await addMatch(db,'score66',{score:66});
  assert.equal((await run()).sent,2);
  assert.deepEqual(messages.map(p=>p.item.urlFonte),[link,'https://portal.gov.br/processo/43']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM alertas_empresa_whatsapp')).rows[0].n,2);
  // Revalidation rejects links changed between selection and reservation.
  await addMatch(db,'mudou');
  const client={query:async(sql,values)=>{
   if(sql.startsWith('INSERT INTO alertas_empresa_whatsapp')) await db.exec("UPDATE licitacoes_pncp SET link_edital=NULL WHERE codigo_externo='mudou'");
   return db.query(sql,values);
  }};
  assert.equal((await run(client)).sent,0);
 }finally{await db.close();}
});

test('lote percorre links inválidos sem bloquear oportunidades válidas posteriores',async()=>{
 const {db,messages,run}=await fixture();
 try {
  await run();
  for(let i=0;i<26;i++) await addMatch(db,'sem-link-'+i,{edital:null});
  await addMatch(db,'com-link');
  assert.equal((await run()).sent,1);assert.equal(messages.length,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM alertas_empresa_whatsapp')).rows[0].n,1);
 }finally{await db.close();}
});

test('desativação, reativação e troca de número excluem matches do intervalo; preferências comuns preservam marco',async()=>{
 const {db,messages,run}=await fixture();
 try {
  await run(); const first=await epoch(db);
  await db.exec("UPDATE usuarios SET nome='Outro nome',alertas_email=false,whatsapp_consentimento_em=clock_timestamp()");
  assert.equal(await epoch(db),first);
  await db.exec('UPDATE usuarios SET alertas_whatsapp=false'); assert.equal(await epoch(db),null);
  await addMatch(db,'desativado');
  await db.exec('UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=clock_timestamp()');
  assert.notEqual(await epoch(db),first); assert.equal((await run()).sent,0);
  await addMatch(db,'reativado'); assert.equal((await run()).sent,1);
  await addMatch(db,'numero-anterior');
  await db.exec("UPDATE usuarios SET whatsapp_numero='+5584999999998',whatsapp_consentimento_em=clock_timestamp()");
  assert.equal((await run()).sent,0);
  await addMatch(db,'numero-novo');assert.equal((await run()).sent,1);
  assert.equal(messages.length,2);
 }finally{await db.close();}
});

test('downgrade/upgrade, suspensão e retorno ao Premium abrem novo marco sem estoque do intervalo',async()=>{
 const {db,run}=await fixture();
 try {
  await run(); const first=await epoch(db);
  await db.exec("UPDATE empresas SET razao_social='Empresa editada'");assert.equal(await epoch(db),first);
  for(const off of ["plano='pro'","status='suspenso'"]) {
   await db.exec('UPDATE empresas SET '+off); assert.equal(await epoch(db),null);
   await addMatch(db,'intervalo-'+off);assert.equal((await run()).sent,0);
   await db.exec("UPDATE empresas SET plano='premium',status='ativo'");assert.ok(await epoch(db));
   assert.equal((await run()).sent,0);
   await addMatch(db,'depois-'+off);assert.equal((await run()).sent,1);
  }
 }finally{await db.close();}
});

test('teste Premium expirado bloqueia; assinatura após expiração reinicia marco; continuidade não reinicia',async()=>{
 const {db,run}=await fixture();
 try {
  await run();
  await db.exec("UPDATE empresas SET plano='pro',teste_status='ativo',teste_fim=now()+interval '1 hour'");
  const first=await epoch(db); assert.ok(first);
  await db.exec("UPDATE empresas SET plano='premium'");assert.equal(await epoch(db),first);
  await db.exec("UPDATE empresas SET plano='pro',teste_fim=now()-interval '1 second'");
  assert.equal(await epoch(db),null);await addMatch(db,'expirado');assert.equal((await run()).sent,0);
  await db.exec("UPDATE empresas SET plano='premium'");assert.ok(await epoch(db));assert.equal((await run()).sent,0);
  await addMatch(db,'assinatura');assert.equal((await run()).sent,1);
  // Expiration by passage of time, without any UPDATE to notify a trigger.
  await db.exec("UPDATE empresas SET plano='pro',teste_status='ativo',teste_fim=clock_timestamp()+interval '100 milliseconds'");
  await new Promise(resolve=>setTimeout(resolve,150));
  await addMatch(db,'expiracao-natural');assert.equal((await run()).sent,0);
  await db.exec("UPDATE empresas SET plano='premium'");assert.equal((await run()).sent,0);
  await addMatch(db,'apos-expiracao-natural');assert.equal((await run()).sent,1);
 }finally{await db.close();}
});

test('flags desligadas e sandbox não estabelecem marco global de produção',async()=>{
 const {db,run}=await fixture();
 try {
  await run(db,{WHATSAPP_ENABLED:'false'});
  await run(db,{WHATSAPP_PRODUCTION_READY:'false'});
  await run(db,{WHATSAPP_MODE:'sandbox'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM whatsapp_ativacao_producao')).rows[0].n,0);
 }finally{await db.close();}
});

test('primeira habilitação após produção exclui matches anteriores; reativação na reserva bloqueia candidato obsoleto',async()=>{
 const {db,run}=await fixture();
 try {
  await run();
  await db.exec('UPDATE usuarios SET alertas_whatsapp=false,whatsapp_consentimento_em=NULL');
  await addMatch(db,'antes-do-consentimento');
  await db.exec('UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=clock_timestamp()');
  assert.equal((await run()).sent,0);
  await addMatch(db,'candidato');
  const client={query:async(sql,values)=>{
   if(sql.startsWith('INSERT INTO alertas_empresa_whatsapp')) {
    await db.exec('UPDATE usuarios SET alertas_whatsapp=false; UPDATE usuarios SET alertas_whatsapp=true,whatsapp_consentimento_em=clock_timestamp()');
   }
   return db.query(sql,values);
  }};
  assert.equal((await run(client)).sent,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM alertas_empresa_whatsapp')).rows[0].n,0);
  await addMatch(db,'apos-novo-marco');assert.equal((await run()).sent,1);
 }finally{await db.close();}
});
