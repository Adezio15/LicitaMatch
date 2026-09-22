import nodemailer from 'nodemailer';
import { createPncpSource } from './sources/pncpSource.js';
import { createComprasnetSource } from './sources/comprasnetSource.js';
import { createSourceRegistry } from './sources/sourceRegistry.js';
import { persistPncpItems } from './pncpPersistenceService.js';
import { correlateOpportunities } from './opportunityService.js';
import { createEmailService } from './emailService.js';
import { safeError } from '../utils/safeError.js';
import { createWhatsAppService } from './whatsappService.js';

export function createOperationsService({ database, config, logger, registry, emailService, whatsappService }) {
  registry ||= createSourceRegistry({
    pncp: { ...createPncpSource(), name: 'PNCP', enabled: config.SYNC_ENABLED === 'true' },
    comprasnet: { ...createComprasnetSource(), name: 'Compras.gov.br', enabled: config.SYNC_ENABLED === 'true' && config.COMPRASNET_ENABLED === 'true' }
  });
  let transport;
  if (!emailService && config.EMAIL_ENABLED === 'true') {
    transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465, requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true });
    emailService = createEmailService({ transport, from: config.EMAIL_FROM });
  }
  const definitions = [];
  if (!whatsappService && config.WHATSAPP_ENABLED === 'true') whatsappService = createWhatsAppService({config});
  for (const source of registry.listSources()) {
    const modalities = (source.id === 'pncp' ? config.PNCP_MODALIDADES : config.COMPRASNET_MODALIDADES).split(',');
    for (const modalidade of new Set(modalities)) definitions.push({ name: `sync:${source.id}:${modalidade}`, source: source.id, modalidade });
  }
  definitions.push({ name: 'matches' });
  if (config.EMAIL_ENABLED === 'true') definitions.push({ name: 'alertas' });
  if (config.WHATSAPP_ENABLED === 'true') definitions.push({name:'alertas_whatsapp'});
  let pending, timer, stopped = false;

  async function synchronize(client, definition, state) {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now() - config.SYNC_LOOKBACK_DAYS * 86400000).toISOString().slice(0,10);
    let cursor = state.cursor?.page ? state.cursor : { page: 1, dataInicial: start, dataFinal: end };
    let inserted = 0, pages = 0;
    for (; pages < config.SYNC_MAX_PAGES && !stopped; pages++) {
      const result = await registry.fetch(definition.source, { ...cursor, pageSize: 50, modalidade: definition.modalidade });
      inserted += await persistPncpItems(client,result.items,definition.source);
      cursor = result.hasMore ? { ...cursor, page: cursor.page + 1 } : {};
      await client.query('UPDATE tarefas SET cursor=$2 WHERE nome=$1', [definition.name,JSON.stringify(cursor)]);
      if (!result.hasMore) { pages++; break; }
    }
    return { inserted,pages,continuation: Boolean(cursor.page) };
  }

  async function alerts(client,channel) {
    const preference = `(($2='email' AND u.alertas_email=true) OR
      ($2='whatsapp' AND u.alertas_whatsapp=true AND u.whatsapp_numero<>''
      AND u.whatsapp_consentimento_em IS NOT NULL AND u.tipo IN ('gestor','admin')))`;
    await client.query(`INSERT INTO alertas (match_id,usuario_id,canal)
      SELECT m.id,u.id,$2 FROM matches m JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
      JOIN empresas e ON e.id=m.empresa_id JOIN usuarios u ON u.empresa_id=m.empresa_id
      WHERE m.score >= $1 AND m.status IN ('novo','aceito') AND i.ativo=true
      AND e.status='ativo' AND u.ativo=true AND ${preference}
      ON CONFLICT (match_id,usuario_id,canal) DO NOTHING`, [config.ALERT_MIN_SCORE,channel]);
    const { rows } = await client.query(`SELECT a.id,u.email,u.whatsapp_numero,e.razao_social,i.titulo,m.score,l.objeto,l.modalidade,l.unidade_gestora
      FROM alertas a JOIN matches m ON m.id=a.match_id
      JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
      JOIN usuarios u ON u.id=a.usuario_id AND u.empresa_id=m.empresa_id
      JOIN empresas e ON e.id=u.empresa_id JOIN licitacoes_pncp l ON l.id=m.licitacao_id
      WHERE a.status='pendente' AND a.canal=$2 AND a.proxima_tentativa<=now() AND a.tentativas<5
      AND u.ativo=true AND ${preference} AND e.status='ativo' AND i.ativo=true
      AND m.score >= $1 AND m.status IN ('novo','aceito') ORDER BY a.id LIMIT 25`, [config.ALERT_MIN_SCORE,channel]);
    let sent = 0, failed = 0;
    for (const row of rows) {
      if (stopped) break;
      try {
        const delivery = channel==='email' ? emailService : whatsappService;
        const result = await delivery.sendMatchAlert({ to: channel==='email' ? row.email : row.whatsapp_numero,customer: row.razao_social,interestName: row.titulo,
          score: row.score,item: { objeto: row.objeto,modalidade: row.modalidade,unidadeGestora: row.unidade_gestora } });
        await client.query("UPDATE alertas SET status='enviado',enviado_em=now(),tentativas=tentativas+1,provedor_mensagem_id=$2 WHERE id=$1", [row.id,result?.messageId || null]);
        sent++;
      } catch (error) {
        await client.query(`UPDATE alertas SET tentativas=tentativas+1,
          status=CASE WHEN tentativas>=4 THEN 'falhou' ELSE 'pendente' END,
          proxima_tentativa=now()+interval '15 minutes' WHERE id=$1`, [row.id]);
        logger.error({ task: 'alertas',channel, error: safeError(error) }, 'Falha no alerta');
        failed++;
      }
    }
    return { sent,failed };
  }

  async function cycle() {
    const client = await database.connect();
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(742193811) AS locked')).rows[0].locked;
      if (!locked) return { skipped: true };
      const results = [];
      // Match existing imports first so a slow source does not block new interests.
      const ordered = [...definitions].sort((a,b) => Number(b.name === 'matches') - Number(a.name === 'matches'));
      for (const definition of ordered) {
        if (stopped) break;
        await client.query('INSERT INTO tarefas (nome) VALUES ($1) ON CONFLICT DO NOTHING', [definition.name]);
        const state = (await client.query("SELECT * FROM tarefas WHERE nome=$1 AND (proxima_execucao<=now() OR estado='executando')", [definition.name])).rows[0];
        if (!state) continue;
        const minutes = definition.source ? config.SYNC_INTERVAL_MINUTES : 1;
        await client.query(`UPDATE tarefas SET estado='executando',ultima_execucao=now(),
          proxima_execucao=now()+($2 * interval '1 minute') WHERE nome=$1`, [definition.name,minutes]);
        try {
          const result = definition.source ? await synchronize(client,definition,state)
            : definition.name === 'matches' ? { matches: await correlateOpportunities(client) } : await alerts(client,definition.name==='alertas_whatsapp' ? 'whatsapp' : 'email');
          await client.query(`UPDATE tarefas SET estado=$3,ultimo_sucesso=now(),resumo=$2,
            proxima_execucao=CASE WHEN $4 THEN now()+interval '1 minute' ELSE proxima_execucao END WHERE nome=$1`,
          [definition.name,JSON.stringify(result),result.failed ? 'parcial' : 'concluido',result.continuation === true]);
          results.push({ name: definition.name,...result });
        } catch (error) {
          await client.query("UPDATE tarefas SET estado='falhou' WHERE nome=$1", [definition.name]);
          logger.error({ task: definition.name,error: safeError(error) }, 'Falha no processamento periódico');
          results.push({ name: definition.name,failed: true });
        }
      }
      // New imports become visible in this same cycle.
      if (results.some(result => result.inserted > 0)) await correlateOpportunities(client);
      return { results };
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(742193811)'); }
        catch (error) { client.release(error); throw error; }
      }
      client.release();
    }
  }
  const service = {
    runOnce() {
      if (pending) return pending;
      pending = cycle().finally(() => { pending = null; });
      return pending;
    },
    start() {
      if (timer || config.WORKER_ENABLED !== 'true') return;
      stopped = false;
      const tick = () => service.runOnce().catch(error => logger.error({ error: safeError(error) }, 'Falha no worker'));
      timer = setInterval(tick,15000).unref();
      tick();
    },
    async stop() {
      stopped = true;
      clearInterval(timer); timer = null;
      await pending;
      transport?.close();
    },
    async overview() {
      const tasks = (await database.query('SELECT * FROM tarefas ORDER BY nome')).rows;
      const alerts = (await database.query('SELECT canal,status,count(*)::int AS total FROM alertas GROUP BY canal,status ORDER BY canal,status')).rows;
      return { tasks,alerts,workerEnabled: config.WORKER_ENABLED === 'true',emailEnabled: config.EMAIL_ENABLED === 'true',whatsappEnabled:config.WHATSAPP_ENABLED==='true',
        sources: registry.listSources(true).map(({ id,name,enabled }) => ({ id,name,enabled })) };
    },
    async schedule() {
      for (const definition of definitions.filter(item => !item.name.startsWith('alertas'))) {
        await database.query(`INSERT INTO tarefas (nome) VALUES ($1)
          ON CONFLICT (nome) DO UPDATE SET proxima_execucao=now()`, [definition.name]);
      }
    }
  };
  return service;
}
