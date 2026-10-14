import { safeOfficialUrl } from './sources/officialLink.js';
import { brazilWhatsAppNumberPattern } from './brazilWhatsAppNumber.js';
import { sandboxAllowed } from './twilioWhatsAppService.js';

// Central authorization gate preserves the current Premium policy; future plans can be added here.
export const whatsappEligibilitySql = "e.status='ativo' AND plano_efetivo(e)='premium' AND u.ativo AND u.tipo IN ('gestor','admin') AND u.alertas_whatsapp AND u.whatsapp_consentimento_em IS NOT NULL AND u.whatsapp_numero ~ '"+brazilWhatsAppNumberPattern+"'";

export async function sendWhatsAppAlerts({ client, config, service, logger, stopped = () => false }) {
  if (config.WHATSAPP_ENABLED !== 'true') return {sent:0,failed:0};
  const sandbox = (config.WHATSAPP_MODE || 'sandbox') === 'sandbox';
  if (!sandbox && (config.WHATSAPP_PRODUCTION_READY !== 'true' || !config.TWILIO_WHATSAPP_CONTENT_SID)) return {sent:0,failed:0};
  let productionCutoff = null;
  if (!sandbox) {
    await client.query(`INSERT INTO whatsapp_ativacao_producao (id,ativado_em)
      VALUES (true,clock_timestamp()) ON CONFLICT DO NOTHING`);
    productionCutoff = (await client.query('SELECT ativado_em::text AS ativado_em FROM whatsapp_ativacao_producao WHERE id=true')).rows[0].ativado_em;
  }
  const freshMatchSql = "u.whatsapp_habilitado_em IS NOT NULL AND m.created_at>u.whatsapp_habilitado_em AND ($6::timestamptz IS NULL OR m.created_at>$6)";
  const sql = [
    "SELECT DISTINCT ON (e.id,l.id,u.whatsapp_numero) e.id AS empresa_id,l.id AS licitacao_id,u.id AS usuario_id,",
    "u.whatsapp_numero,e.razao_social,i.titulo,m.id AS match_id,m.score,l.objeto,l.unidade_gestora,l.modalidade,l.link_edital,l.url_fonte,l.cidade,l.uf,",
    "(SELECT max(recebido_em) FROM whatsapp_inbound WHERE numero=u.whatsapp_numero) AS last_inbound",
    "FROM matches m JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id",
    "JOIN empresas e ON e.id=m.empresa_id JOIN usuarios u ON u.empresa_id=e.id JOIN licitacoes_pncp l ON l.id=m.licitacao_id",
    "WHERE m.score>=67 AND m.status IN ('novo','aceito') AND i.ativo AND licitacao_permitida(l.modalidade,l.uf) AND "+whatsappEligibilitySql,
    "AND "+freshMatchSql,
    "AND ($3::bigint IS NULL OR (e.id,l.id,u.whatsapp_numero)>($3::bigint,$4::bigint,$5::text))",
    "AND NOT EXISTS (SELECT 1 FROM alertas_empresa_whatsapp a WHERE a.empresa_id=e.id AND a.licitacao_id=l.id AND a.numero=u.whatsapp_numero)",
    // Historical users may change their number; old sends still block the same user/opportunity.
    "AND NOT EXISTS (SELECT 1 FROM alertas a JOIN matches old ON old.id=a.match_id WHERE a.canal='whatsapp' AND a.usuario_id=u.id AND old.licitacao_id=l.id AND (a.status<>'pendente' OR a.tentativas>0))",
    "AND ($1::boolean=false OR (u.whatsapp_numero=ANY($2::text[]) AND EXISTS (SELECT 1 FROM whatsapp_inbound w WHERE w.numero=u.whatsapp_numero AND w.recebido_em>now()-interval '24 hours')))",
    "ORDER BY e.id,l.id,u.whatsapp_numero,m.score DESC,m.id LIMIT 25"
  ].join(' ');
  const numbers = (config.WHATSAPP_SANDBOX_NUMBERS || '').split(',').map(n=>n.trim()).filter(Boolean);
  let sent=0,failed=0,cursor=null;
  // Invalid links do not consume the delivery batch or starve later opportunities.
  while (sent+failed<25) {
    const {rows} = await client.query(sql,[sandbox,numbers,cursor?.empresa_id ?? null,
      cursor?.licitacao_id ?? null,cursor?.whatsapp_numero ?? null,productionCutoff]);
    if (!rows.length) break;
    for (const row of rows) {
      if (sent+failed>=25) break;
      if (stopped()) return {sent,failed};
      if (sandbox && !sandboxAllowed(config,row.whatsapp_numero)) continue;
      const opportunityUrl = safeOfficialUrl(row.link_edital) || safeOfficialUrl(row.url_fonte);
      if (!opportunityUrl) continue;
      // Atomically claim and recheck consent/company status immediately before external I/O.
      const claim = await client.query([
        "INSERT INTO alertas_empresa_whatsapp (empresa_id,licitacao_id,usuario_id,numero)",
        "SELECT e.id,$2,u.id,u.whatsapp_numero FROM empresas e JOIN usuarios u ON u.empresa_id=e.id",
        "JOIN matches m ON m.empresa_id=e.id AND m.id=$5 JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=e.id",
        "JOIN licitacoes_pncp l ON l.id=m.licitacao_id",
        "WHERE e.id=$1 AND l.id=$2 AND u.id=$3 AND u.whatsapp_numero=$4 AND "+whatsappEligibilitySql,
        "AND m.score>=67 AND m.status IN ('novo','aceito') AND i.ativo AND licitacao_permitida(l.modalidade,l.uf)",
        "AND u.whatsapp_habilitado_em IS NOT NULL AND m.created_at>u.whatsapp_habilitado_em",
        "AND ($8::timestamptz IS NULL OR m.created_at>$8)",
        "AND l.link_edital IS NOT DISTINCT FROM $6::text AND l.url_fonte IS NOT DISTINCT FROM $7::text",
        "ON CONFLICT DO NOTHING RETURNING id"
      ].join(' '),[row.empresa_id,row.licitacao_id,row.usuario_id,row.whatsapp_numero,row.match_id,row.link_edital,row.url_fonte,productionCutoff]);
      if (!claim.rows.length) continue;
      const id=claim.rows[0].id;
      let result;
      try {
        result = await service.sendMatchAlert({to:row.whatsapp_numero,customer:row.razao_social,interestName:row.titulo,
          score:row.score,lastInboundAt:row.last_inbound,item:{objeto:row.objeto,unidadeGestora:row.unidade_gestora,
            modalidade:row.modalidade,municipio:row.cidade,uf:row.uf,urlFonte:opportunityUrl}});
        if (!result?.accepted || !result.messageId) throw new Error('Aceita??o n?o confirmada.');
      } catch (error) {
        await client.query("UPDATE alertas_empresa_whatsapp SET status=$2,erro_codigo=$3 WHERE id=$1",
          [id,error.definitive ? 'falhou':'incerto',Number.isInteger(error.providerCode)?error.providerCode:null]);
        logger.error({event:'whatsapp.alert.failed',alertId:id,uncertain:!error.definitive},'Falha no alerta WhatsApp');
        failed++;
        continue;
      }
      // If persistence fails after acceptance the durable claim stays 'enviando'; no automatic resend.
      await client.query("UPDATE alertas_empresa_whatsapp SET status='enviado',enviado_em=now(),provedor_mensagem_id=$2 WHERE id=$1",[id,result.messageId]);
      logger.info({event:'whatsapp.alert.accepted',alertId:id,messageId:result.messageId},'Alerta aceito pela Twilio');
      sent++;
    }
    if (rows.length<25) break;
    cursor=rows.at(-1);
  }
  return {sent,failed};
}
