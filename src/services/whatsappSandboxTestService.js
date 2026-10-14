import { createHash } from 'node:crypto';
import { whatsappEligibilitySql } from './whatsappAlertsService.js';
import { sandboxAllowed, createWhatsAppService } from './twilioWhatsAppService.js';
import { safeOfficialUrl } from './sources/officialLink.js';

export async function prepareSandboxTest(client, config, { empresaId, usuarioId, email }) {
  if (config.WHATSAPP_ENABLED !== 'false' || config.WHATSAPP_PRODUCTION_READY !== 'false' || config.WHATSAPP_MODE !== 'sandbox')
    throw new Error('Mantenha WhatsApp e produção desativados, no modo sandbox.');
  if (email !== undefined) {
    if (usuarioId !== undefined || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      throw new Error('Informe --email válido ou --usuario, exclusivamente.');
    if (!/^[1-9]\d*$/.test(String(empresaId))) throw new Error('Informe a empresa explicitamente.');
    const found=await client.query('SELECT id FROM usuarios WHERE empresa_id=$1 AND lower(email)=lower($2)',[empresaId,email.trim()]);
    if (found.rows.length !== 1) throw new Error('E-mail não identifica uma conta única nesta empresa.');
    usuarioId=String(found.rows[0].id);
  }
  if (![empresaId,usuarioId].every(id => /^[1-9]\d*$/.test(String(id)))) throw new Error('Informe empresa e usuário explicitamente.');
  const { rows } = await client.query(`SELECT e.id AS empresa_id,u.id AS usuario_id,u.whatsapp_numero,
    m.id AS match_id,m.score,l.id AS licitacao_id,l.objeto,l.unidade_gestora,l.cidade,l.uf,l.url_fonte,
    to_jsonb(l)->>'valor_estimado' AS valor_estimado,
    (SELECT max(recebido_em) FROM whatsapp_inbound WHERE numero=u.whatsapp_numero) AS last_inbound
    FROM empresas e JOIN usuarios u ON u.empresa_id=e.id JOIN matches m ON m.empresa_id=e.id
    JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=e.id JOIN licitacoes_pncp l ON l.id=m.licitacao_id
    WHERE e.id=$1 AND u.id=$2 AND ${whatsappEligibilitySql}
    AND m.score>=67 AND m.status IN ('novo','aceito') AND i.ativo AND licitacao_permitida(l.modalidade,l.uf)
    AND u.whatsapp_numero=ANY($3::text[])
    AND NOT EXISTS (SELECT 1 FROM alertas_empresa_whatsapp a WHERE a.empresa_id=e.id AND a.licitacao_id=l.id AND a.numero=u.whatsapp_numero)
    AND NOT EXISTS (SELECT 1 FROM alertas a JOIN matches old ON old.id=a.match_id WHERE a.canal='whatsapp' AND a.usuario_id=u.id AND old.licitacao_id=l.id AND (a.status<>'pendente' OR a.tentativas>0))
    ORDER BY m.score DESC,l.id,m.id LIMIT 1`, [empresaId,usuarioId,(config.WHATSAPP_SANDBOX_NUMBERS || '').split(',').map(n=>n.trim())]);
  const row=rows[0];
  if (!row || !sandboxAllowed(config,row.whatsapp_numero)) throw new Error('Nenhuma oportunidade ou destinatário elegível.');
  if (!safeOfficialUrl(row.url_fonte)) throw new Error('Oportunidade sem link válido.');
  const last=new Date(row.last_inbound).getTime();
  if (!Number.isFinite(last) || last>Date.now() || Date.now()-last>=86400000) throw new Error('Envie uma mensagem ao Sandbox para abrir a janela de 24 horas; templates genéricos não comportam este alerta.');
  const confirmation=createHash('sha256').update(JSON.stringify([row.empresa_id,row.usuario_id,row.whatsapp_numero,row.match_id,row.licitacao_id,row.score,row.objeto,row.unidade_gestora,row.cidade,row.uf,row.url_fonte,row.valor_estimado])).digest('hex');
  return {row,confirmation};
}

export async function runSandboxTest(client, config, options, provider) {
  const prepared=await prepareSandboxTest(client,config,options);
  if (!options.confirmation) return prepared;
  if (config.WHATSAPP_SANDBOX_TEST_ENABLED !== 'true') throw new Error('Ative somente WHATSAPP_SANDBOX_TEST_ENABLED para autorizar o comando.');
  if (options.confirmation !== prepared.confirmation) throw new Error('Confirmação não corresponde à prévia atual.');
  let alertId;
  await client.query('BEGIN');
  try {
    // Serialize concurrent commands and revalidate inside the reservation transaction.
    await client.query('LOCK TABLE whatsapp_sandbox_test IN EXCLUSIVE MODE');
    if ((await client.query('SELECT id FROM whatsapp_sandbox_test')).rows.length) throw new Error('Teste já reservado; não haverá reenvio.');
    const {row,confirmation}=await prepareSandboxTest(client,config,options);
    if (confirmation !== options.confirmation) throw new Error('Elegibilidade ou oportunidade mudou. Gere outra prévia.');
    const claim=await client.query(`INSERT INTO alertas_empresa_whatsapp (empresa_id,licitacao_id,usuario_id,numero)
      SELECT e.id,$2,u.id,u.whatsapp_numero FROM empresas e JOIN usuarios u ON u.empresa_id=e.id
      WHERE e.id=$1 AND u.id=$3 AND u.whatsapp_numero=$4 AND ${whatsappEligibilitySql}
      ON CONFLICT DO NOTHING RETURNING id`,[row.empresa_id,row.licitacao_id,row.usuario_id,row.whatsapp_numero]);
    if (!claim.rows.length) throw new Error('Destinatário inelegível ou alerta já reservado.');
    alertId=claim.rows[0].id;
    await client.query('INSERT INTO whatsapp_sandbox_test (confirmation,alerta_id) VALUES ($1,$2)',[confirmation,alertId]);
    await client.query('COMMIT');
    prepared.row=row;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  const row=prepared.row;
  let result;
  try {
    result=await createWhatsAppService({config,client:provider,sandboxTest:true}).sendMatchAlert({to:row.whatsapp_numero,score:row.score,lastInboundAt:row.last_inbound,
      item:{objeto:row.objeto,unidadeGestora:row.unidade_gestora,municipio:row.cidade,uf:row.uf,urlFonte:row.url_fonte,valorEstimado:row.valor_estimado}});
  } catch(error) {
    await client.query('UPDATE alertas_empresa_whatsapp SET status=$2,erro_codigo=$3 WHERE id=$1',[alertId,error.definitive?'falhou':'incerto',error.providerCode || null]);
    throw error;
  }
  await client.query("UPDATE alertas_empresa_whatsapp SET status='enviado',enviado_em=now(),provedor_mensagem_id=$2 WHERE id=$1",[alertId,result.messageId]);
  return {alertId,...result};
}
