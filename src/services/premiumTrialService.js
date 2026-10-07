import { HttpError } from '../utils/httpError.js';
import { sendEmail } from './emailDiagnostics.js';

export function premiumTrialService(database, config, logger, deliverEmail = sendEmail) {
  async function transaction(work) {
    const client = await database.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function notify(client, subject, body, to) {
    const recipients = to ? [to] : config.ADMIN_EMAIL ? [config.ADMIN_EMAIL] : (await client.query("SELECT email FROM usuarios WHERE tipo='admin' AND ativo=true")).rows.map(r => r.email);
    for (const recipient of new Set(recipients)) await client.query('INSERT INTO notificacoes_plano (destinatario,assunto,corpo) VALUES ($1,$2,$3)', [recipient,subject,body]);
  }
  const formatDate = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)';
  const details = (e, user) => `Empresa: ${e.razao_social}\nCNPJ: ${e.cnpj}\nResponsável: ${user.nome}\nE-mail: ${user.email}\nTelefone: ${e.telefone || 'Não informado'}\nData: ${formatDate(Date.now())}\nStatus: ${e.teste_status}`;
  return {
    async flushEmails() {
      if (config.EMAIL_ENABLED !== 'true') return;
      // Row locks prevent concurrent workers from delivering the same notification.
      await transaction(async client => {
        const { rows } = await client.query('SELECT * FROM notificacoes_plano WHERE enviado_em IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED');
        for (const row of rows) {
          try {
            await deliverEmail({ config, logger, payload: { from: config.EMAIL_FROM, to: row.destinatario, subject: row.assunto, text: row.corpo }, context: { notificationId: row.id } });
            await client.query('UPDATE notificacoes_plano SET enviado_em=now(),tentativas=tentativas+1 WHERE id=$1',[row.id]);
          } catch { await client.query('UPDATE notificacoes_plano SET tentativas=tentativas+1 WHERE id=$1',[row.id]); logger?.error({event:'trial.email.failed', notificationId:row.id},'Falha na notificação de plano; envio será repetido'); }
        }
      });
    },
    async request(user, metadata) {
      const result = await transaction(async client => {
        const e = (await client.query('SELECT * FROM empresas WHERE id=$1 FOR UPDATE',[user.empresa_id])).rows[0];
        // Serialize requests by CNPJ as well as company. History survives changes to the current CNPJ.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[e.cnpj]);
        const history = (await client.query('SELECT * FROM testes_premium WHERE empresa_id=$1 OR cnpj=$2',[e.id,e.cnpj])).rows[0];
        if (history || e.teste_status !== 'nao_solicitado' || e.teste_utilizado_em) {
          await client.query('INSERT INTO testes_premium_tentativas (empresa_id,usuario_id,cnpj,ip,user_agent) VALUES ($1,$2,$3,$4,$5)',[e.id,user.id,e.cnpj,metadata.ip,metadata.userAgent]);
          logger?.warn({event:'trial.reuse',empresaId:e.id,usuarioId:user.id,cnpj:e.cnpj,ip:metadata.ip,userAgent:metadata.userAgent,attemptedAt:new Date().toISOString()},'Tentativa de reutilização do teste Premium');
          await notify(client,'Alerta - tentativa de reutilização do teste Premium',`${details(e,user)}\nTeste anterior: ${history?.inicio_em || history?.solicitado_em || e.teste_utilizado_em}\nIP: ${metadata.ip}\nUser-agent: ${metadata.userAgent}`);
          return false;
        }
        await client.query("INSERT INTO testes_premium (empresa_id,cnpj,usuario_id,status,ip_solicitacao,user_agent) VALUES ($1,$2,$3,'aguardando_aprovacao',$4,$5)",[e.id,e.cnpj,user.id,metadata.ip,metadata.userAgent]);
        await client.query("UPDATE empresas SET teste_status='aguardando_aprovacao',teste_solicitado_em=now() WHERE id=$1",[e.id]);
        e.teste_status='aguardando_aprovacao';
        await notify(client,'Nova solicitação de teste Premium - LicitaMatch',`${details(e,user)}\nAnalisar solicitação: /admin/testes-premium`);
        return true;
      });
      await this.flushEmails();
      if (!result) throw new HttpError(403,'Sua empresa já solicitou ou utilizou o período de teste gratuito do LicitaMatch.');
      return { message:'Sua solicitação de teste Premium foi enviada e está aguardando aprovação.' };
    },
    async list(id = null) {
      return (await database.query(`SELECT t.*,e.razao_social,e.telefone,u.nome,u.email,
        CASE WHEN t.status='ativo' AND t.fim_em<=now() THEN 'expirado' ELSE t.status END AS status
        FROM testes_premium t JOIN empresas e ON e.id=t.empresa_id JOIN usuarios u ON u.id=t.usuario_id
        WHERE ($1::bigint IS NULL OR t.id=$1) ORDER BY t.solicitado_em DESC`,[id])).rows;
    },
    async decide(id, admin, approve) {
      await transaction(async client => {
        const initial = (await client.query('SELECT empresa_id FROM testes_premium WHERE id=$1',[id])).rows[0];
        if (!initial) throw new HttpError(404,'Solicitação não encontrada');
        await client.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE',[initial.empresa_id]);
        const trial = (await client.query('SELECT * FROM testes_premium WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if (trial.status !== 'aguardando_aprovacao') throw new HttpError(409,'Esta solicitação já foi analisada.');
        const status = approve ? 'ativo' : 'recusado';
        // Capture database time after lock acquisition; contention must not shorten the trial.
        const approvalTime = approve ? (await client.query('SELECT clock_timestamp() AS approved_at')).rows[0].approved_at : null;
        await client.query(`UPDATE testes_premium SET status=$2,aprovado_por=$3,
          aprovado_em=CASE WHEN $4 THEN $5::timestamptz END,inicio_em=CASE WHEN $4 THEN $5::timestamptz END,
          fim_em=CASE WHEN $4 THEN $5::timestamptz+interval '24 hours' END WHERE id=$1`,[id,status,admin.id,approve,approvalTime]);
        const e = (await client.query(`UPDATE empresas SET teste_status=$2,teste_aprovado_por=$3,
          teste_aprovado_em=CASE WHEN $4 THEN $5::timestamptz END,teste_inicio=CASE WHEN $4 THEN $5::timestamptz END,
          teste_fim=CASE WHEN $4 THEN $5::timestamptz+interval '24 hours' END,
          teste_utilizado_em=CASE WHEN $4 THEN $5::timestamptz ELSE teste_utilizado_em END,
          plano=CASE WHEN $4 AND plano='sem_plano' THEN 'premium_teste' ELSE plano END
          WHERE id=$1 RETURNING *`,[trial.empresa_id,status,admin.id,approve,approvalTime])).rows[0];
        const u = (await client.query('SELECT nome,email FROM usuarios WHERE id=$1',[trial.usuario_id])).rows[0];
        await notify(client,approve ? 'Seu teste Premium foi aprovado!' : 'Sua solicitação de teste Premium foi recusada',
          approve ? `Você terá acesso a todos os recursos Premium durante 24 horas.\nInício: ${formatDate(e.teste_inicio)}\nTérmino: ${formatDate(e.teste_fim)}` : 'Sua solicitação foi analisada e recusada. Entre em contato com a equipe do LicitaMatch.',u.email);
      });
      await this.flushEmails();
    },
    async contract(user, plan) {
      if (!['start','pro','premium'].includes(plan)) throw new HttpError(422,'Selecione Start, Pro ou Premium.');
      const e = (await database.query('SELECT * FROM empresas WHERE id=$1',[user.empresa_id])).rows[0];
      await notify(database,'Solicitação de contratação - LicitaMatch',`${details(e,user)}\nPlano desejado: ${plan}`);
      await this.flushEmails();
      return {message:'Solicitação de contratação enviada. Nossa equipe entrará em contato.'};
    }
  };
}
