import pg from 'pg';
import { loadEnvironment, parseEnv } from '../src/config/env.js';
import { runSandboxTest } from '../src/services/whatsappSandboxTestService.js';

let client;
try {
  const args=process.argv.slice(2), options={};
  const names={'--empresa':'empresaId','--cnpj':'cnpj','--usuario':'usuarioId','--email':'email','--confirm':'confirmation'};
  for(let index=0;index<args.length;index+=2) {
    if (!names[args[index]] || !args[index+1] || options[names[args[index]]]) throw new Error('Use --cnpj CNPJ ou --empresa ID, com --email EMAIL ou --usuario ID [--confirm TOKEN].');
    options[names[args[index]]]=args[index+1];
  }
  loadEnvironment();
  const config=parseEnv(process.env);
  client=new pg.Client({connectionString:config.DATABASE_DIRECT_URL || config.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'licitamatch-sandbox-test'});
  client.on('error',()=>{console.error('Conexão interrompida. Confira o histórico antes de qualquer ação.');process.exitCode=1;});
  await client.connect();
  if (options.cnpj) {
    if(options.empresaId || !/^\d{14}$/.test(options.cnpj.replace(/\D/g,''))) throw new Error('Informe --cnpj válido ou --empresa, exclusivamente.');
    const {rows}=await client.query("SELECT id FROM empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1",[options.cnpj.replace(/\D/g,'')]);
    if(rows.length!==1) throw new Error('Empresa não encontrada de forma única.');
    options.empresaId=String(rows[0].id);
  }
  const result=await runSandboxTest(client,config,options);
  if(result.row) {
    const r=result.row;
    console.log(JSON.stringify({empresa:r.empresa_id,usuario:r.usuario_id,destinatario:r.whatsapp_numero,licitacao:r.licitacao_id,orgao:r.unidade_gestora,objeto:r.objeto,municipio:r.cidade,uf:r.uf,valorEstimado:r.valor_estimado,compatibilidade:r.score,link:r.url_fonte},null,2));
    console.log(`Confirme esta única mensagem com: npm run whatsapp:test:sandbox -- --empresa ${options.empresaId} --usuario ${r.usuario_id} --confirm ${result.confirmation}`);
  } else console.log(`Aceito pela Twilio: ${result.messageId}. Alerta ${result.alertId}; confira a entrega no Console Twilio e no WhatsApp.`);
} catch(error) {
  // Database/provider errors can contain credentials or personal data.
  console.error(error.code || error.severity ? 'Falha no comando. Confira configuração, migrations e histórico; nenhum reenvio automático.' : error.message);
  process.exitCode=1;
} finally { if(client) await client.end().catch(()=>{process.exitCode=1;}); }
