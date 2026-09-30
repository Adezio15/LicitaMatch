import { emailTransport, diagnosticTransport, sendTestEmail, emailError } from './emailDiagnostics.js';
import { createPncpSource } from './sources/pncpSource.js';
import { createComprasnetSource } from './sources/comprasnetSource.js';
import { createSourceRegistry } from './sources/sourceRegistry.js';
import { persistPncpItems } from './pncpPersistenceService.js';
import { correlateOpportunities } from './opportunityService.js';
import { emailProvider, emailFields } from '../config/email.js';
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
    transport = emailTransport(config);
    emailService = createEmailService({ transport: diagnosticTransport({ transport, config, logger, provider: emailProvider(config) }), from: config.EMAIL_FROM });
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
    let inserted = 0, pages = 0, found = 0;
    logger.info({ event: 'search.start', task: definition.name, cursor }, 'Início da busca por licitações');
    for (; pages < config.SYNC_MAX_PAGES && !stopped; pages++) {
      const result = await registry.fetch(definition.source, { ...cursor, pageSize: 50, modalidade: definition.modalidade });
      found += result.items.length;
      logger.info({ event: 'search.page', task: definition.name, page: cursor.page, found: result.items.length }, 'Licitações encontradas na página');
      inserted += await persistPncpItems(client,result.items,definition.source);
      cursor = result.hasMore ? { ...cursor, page: cursor.page + 1 } : {};
      await client.query('UPDATE tarefas SET cursor=$2 WHERE nome=$1', [definition.name,JSON.stringify(cursor)]);
      if (!result.hasMore) { pages++; break; }
    }
    logger.info({ event: 'search.complete', task: definition.name, found, inserted, pages }, 'Busca concluída');
    return { inserted,pages,continuation: Boolean(cursor.page) };
  }

  async function diagnoseEmail(client) {
    const { rows } = await client.query(`SELECT e.id AS empresa_id,e.razao_social,e.email AS email_empresa,
      u.email AS destinatario, count(DISTINCT m.licitacao_id)::int AS licitacoes,
      count(DISTINCT m.licitacao_id) FILTER (WHERE m.score>=67)::int AS matches_67,
      CASE WHEN $2<>'true' THEN 'EMAIL_ENABLED=false'
        WHEN e.status<>'ativo' THEN 'empresa_inativa'
        WHEN u.id IS NULL THEN 'sem_usuario_destinatario'
        WHEN u.ativo=false THEN 'usuario_inativo'
        WHEN u.alertas_email=false THEN 'preferencia_email_desativada'
        WHEN m.id IS NULL THEN 'sem_match'
        WHEN i.ativo=false THEN 'interesse_inativo'
        WHEN m.score<$1 THEN 'score_abaixo_do_limite'
        WHEN m.status NOT IN ('novo','aceito') THEN 'status_match_nao_elegivel'
        WHEN NOT licitacao_permitida(l.modalidade,l.uf) THEN 'modalidade_ou_uf_nao_permitida'
        WHEN a.status='enviado' THEN 'ja_enviado'
        WHEN a.status='falhou' OR a.tentativas>=5 THEN 'tentativas_esgotadas'
        WHEN a.proxima_tentativa>now() THEN 'aguardando_nova_tentativa'
        ELSE 'elegivel_aguardando_lote' END AS motivo
      FROM empresas e LEFT JOIN usuarios u ON u.empresa_id=e.id
      LEFT JOIN matches m ON m.empresa_id=e.id
      LEFT JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=e.id
      LEFT JOIN licitacoes_pncp l ON l.id=m.licitacao_id
      LEFT JOIN alertas a ON a.match_id=m.id AND a.usuario_id=u.id AND a.canal='email'
      GROUP BY e.id,e.razao_social,e.email,u.email,motivo`, [config.ALERT_MIN_SCORE,config.EMAIL_ENABLED]);
    for (const row of rows) logger.info({ event: 'email.eligibility', ...row,
      envio: row.motivo === 'elegivel_aguardando_lote' ? 'aguardando_lote' : 'ignorado',
      alertMinScore: config.ALERT_MIN_SCORE }, 'Empresa analisada para envio de e-mail');
  }

  async function alerts(client,channel) {
    if (channel === 'email') await diagnoseEmail(client);
    const preference = `(($2='email' AND u.alertas_email=true) OR
      ($2='whatsapp' AND u.alertas_whatsapp=true AND u.whatsapp_numero<>''
      AND u.whatsapp_consentimento_em IS NOT NULL AND u.tipo IN ('gestor','admin')))`;
    await client.query(`INSERT INTO alertas (match_id,usuario_id,canal)
      SELECT m.id,u.id,$2 FROM matches m JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
      JOIN licitacoes_pncp l ON l.id=m.licitacao_id
      JOIN empresas e ON e.id=m.empresa_id JOIN usuarios u ON u.empresa_id=m.empresa_id
      WHERE m.score >= $1 AND m.status IN ('novo','aceito') AND i.ativo=true
      AND e.status='ativo' AND u.ativo=true AND ${preference} AND licitacao_permitida(l.modalidade,l.uf)
      ON CONFLICT (match_id,usuario_id,canal) DO NOTHING`, [config.ALERT_MIN_SCORE,channel]);
    const { rows } = await client.query(`SELECT a.id,u.email,u.whatsapp_numero,e.razao_social,i.titulo,m.score,l.objeto,l.modalidade,l.unidade_gestora
      FROM alertas a JOIN matches m ON m.id=a.match_id
      JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
      JOIN usuarios u ON u.id=a.usuario_id AND u.empresa_id=m.empresa_id
      JOIN empresas e ON e.id=u.empresa_id JOIN licitacoes_pncp l ON l.id=m.licitacao_id
      WHERE a.status='pendente' AND a.canal=$2 AND a.proxima_tentativa<=now() AND a.tentativas<5
      AND u.ativo=true AND ${preference} AND e.status='ativo' AND i.ativo=true
      AND m.score >= $1 AND m.status IN ('novo','aceito') AND licitacao_permitida(l.modalidade,l.uf) ORDER BY a.id LIMIT 25`, [config.ALERT_MIN_SCORE,channel]);
    logger.info({ event: 'alerts.batch', channel, selected: rows.length, limit: 25 }, 'Fila selecionada para envio');
    let sent = 0, failed = 0;
    for (const row of rows) {
      if (stopped) { logger.info({ event: 'alert.skipped', channel, reason: 'worker_encerrando' }, 'Envio ignorado'); break; }
      logger.info({ event: 'alert.called', channel, alertId: row.id, empresa: row.razao_social, recipient: channel === 'email' ? row.email : row.whatsapp_numero }, 'Envio chamado');
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
        logger.error({ task: 'alertas',channel, alertId: row.id, error: emailError(error, config) }, 'Falha no alerta');
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
      if (!locked) { logger.info({ event: 'worker.skipped', reason: 'outro_worker_em_execucao' }, 'Ciclo ignorado'); return { skipped: true }; }
      const results = [];
      // Match existing imports first so a slow source does not block new interests.
      const ordered = [...definitions].sort((a,b) => Number(b.name === 'matches') - Number(a.name === 'matches'));
      for (const definition of ordered) {
        if (stopped) break;
        await client.query('INSERT INTO tarefas (nome) VALUES ($1) ON CONFLICT DO NOTHING', [definition.name]);
        const state = (await client.query("SELECT * FROM tarefas WHERE nome=$1 AND (proxima_execucao<=now() OR estado='executando')", [definition.name])).rows[0];
        if (!state) { logger.info({ event: 'task.skipped', task: definition.name, reason: 'aguardando_proxima_execucao' }, 'Tarefa ignorada'); continue; }
        const minutes = definition.source ? config.SYNC_INTERVAL_MINUTES : 1;
        await client.query(`UPDATE tarefas SET estado='executando',ultima_execucao=now(),
          proxima_execucao=now()+($2 * interval '1 minute') WHERE nome=$1`, [definition.name,minutes]);
        try {
          if (definition.name.startsWith('alertas') && results.some(result => result.inserted > 0) && !results.some(result => result.name === 'imported-matches')) {
            results.push({ name: 'imported-matches', matches: await correlateOpportunities(client, null, logger) });
          }
          const result = definition.source ? await synchronize(client,definition,state)
            : definition.name === 'matches' ? { matches: await correlateOpportunities(client, null, logger) } : await alerts(client,definition.name==='alertas_whatsapp' ? 'whatsapp' : 'email');
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
      if (results.some(result => result.inserted > 0) && !results.some(result => result.name === 'imported-matches')) await correlateOpportunities(client, null, logger);
      if (config.EMAIL_ENABLED !== 'true') await diagnoseEmail(client);
      return { results };
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(742193811)'); }
        catch (error) { client.release(error); throw error; }
      }
      client.release();
    }
  }
  function channelDiagnostic(flag, fields) {
    const missing = fields.filter(field => !config[field]);
    if (missing.length) return 'Configuração ausente: ' + missing.join(', ') + '.';
    if (config[flag] !== 'true') return flag + '=false desativa o envio.';
    if (config.WORKER_ENABLED !== 'true') return 'WORKER_ENABLED=false impede o processamento dos alertas.';
    return 'Pronto para envio. Verifique a fila e as preferências dos destinatários.';
  }
  const service = {
    sendTestEmail(to, requestId) { return sendTestEmail({ config, logger, to, requestId }); },
    runOnce() {
      if (pending) return pending;
      pending = cycle().finally(() => { pending = null; });
      return pending;
    },
    start() {
      logger.info({ event: 'worker.start', workerEnabled: config.WORKER_ENABLED, syncEnabled: config.SYNC_ENABLED, emailEnabled: config.EMAIL_ENABLED, emailProvider: emailProvider(config), provider: emailProvider(config), alertMinScore: config.ALERT_MIN_SCORE, sources: registry.listSources(true).map(({id,enabled}) => ({id,enabled})) }, 'Configuração do processamento automático');
      if (timer || config.WORKER_ENABLED !== 'true') { logger.info({ event: 'worker.skipped', reason: timer ? 'ja_iniciado' : 'WORKER_ENABLED=false' }, 'Inicialização ignorada'); return; }
      stopped = false;
      const tick = () => service.runOnce().catch(error => logger.error({ error: safeError(error) }, 'Falha no worker'));
      timer = setInterval(tick,15000).unref();
      tick();
    },
    async stop() {
      stopped = true;
      clearInterval(timer); timer = null;
      await pending;
      transport?.close?.();
    },
    async overview() {
      const tasks = (await database.query('SELECT * FROM tarefas ORDER BY nome')).rows;
      const alerts = (await database.query('SELECT canal,status,count(*)::int AS total FROM alertas GROUP BY canal,status ORDER BY canal,status')).rows;
      return { tasks,alerts,workerEnabled: config.WORKER_ENABLED === 'true',emailEnabled: config.EMAIL_ENABLED === 'true',whatsappEnabled:config.WHATSAPP_ENABLED==='true',
        diagnostics: { email: channelDiagnostic('EMAIL_ENABLED', emailFields(config)), whatsapp: channelDiagnostic('WHATSAPP_ENABLED', ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE_NAME']) },
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
