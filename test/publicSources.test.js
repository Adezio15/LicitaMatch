import test from 'node:test';
import assert from 'node:assert/strict';
import { createSenacSource, normalizeSenacItems } from '../src/services/sources/senacSource.js';
import { createSescSource, normalizeSescItems } from '../src/services/sources/sescSource.js';
import { createRecifeSource, normalizeRecifeItems } from '../src/services/sources/recifeSource.js';
import { createDefaultSourceRegistry, sourceTaskDefinitions } from '../src/services/sources/defaultSources.js';
import { listPortalSources } from '../src/services/sources/portalCatalog.js';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { createOperationsService } from '../src/services/operationsService.js';

const senacRecord = { id: 'process-1', objeto: 'Compra de notebooks', situacao: 'Em processo', dataAbertura: '2026-10-09T10:00:00Z' };
const senacPayload = records => ({ success: true, data: [{ modalidade: 'Pregão Eletrônico', dadosModalidadeLicitacao: records }] });
const sescRecord = { ANO_LICITACAO: '2026', NUMERO_PROCESSO: '001/26-PG', DESC_OBJETO: 'Notebooks', MOD_LICITACAO: 'PREGÃO ELETRÔNICO', DT_ABERTURA_PROPOSTAS: '09/10/2026', SITUACAO: 'EM ANDAMENTO' };
const recifeRecord = { _id: 1, orgaolicitante: 'Secretaria', comissaolicitacao: 'Comissão 1', anoprocessolicitatorio: 2026, numeroprocessolicitatorio: 1, objeto: 'Notebooks', modalidadeprocessolicitatorio: 'PREGÃO ELETRÔNICO', dataaberturaproposta: '2026-10-09T09:00:00' };
const ok = payload => ({ ok: true, json: async () => payload });

test('Senac preserves valid supplied document links, namespaces IDs and excludes terminal/suspended/invalid processes', () => {
  const items = normalizeSenacItems(senacPayload([
    { ...senacRecord, documentos: [{ nomeDocumento: 'EDITAL 1.', arquivoLicitacao: { nomeArquivoFisico: 'https://senac.example/edital.pdf' } }] },
    { ...senacRecord, id: 'relative', documentos: [{ nomeDocumento: 'Edital', arquivoLicitacao: { nomeArquivoFisico: 'Licitações/relative.pdf' } }] },
    ...['Finalizada', 'Cancelada', 'Suspensa'].map(situacao => ({ ...senacRecord, situacao })),
    { ...senacRecord, id: '', dataAbertura: 'invalid' }
  ]), 'RN');
  assert.equal(items.length, 2);
  assert.equal(items.find(item => item.id.endsWith('process-1')).urlFonte, 'https://senac.example/edital.pdf');
  assert.equal(items.find(item => item.id.endsWith('relative')).urlFonte, undefined);
  assert.ok(items.every(item => item.uf === 'RN' && item.id.startsWith('senac:rn:')));
  assert.equal(normalizeSenacItems(senacPayload([senacRecord]), 'DN')[0].uf, undefined);
  assert.throws(() => normalizeSenacItems({ success: false, data: [] }, 'RN'), /inválido/);
});

test('Senac snapshot pagination avoids repeating full downloads and refreshes at next cycle', async () => {
  let calls = 0;
  const source = createSenacSource({ id: 'portal-81', regional: 'RN', fetchImpl: async url => {
    calls++; assert.equal(url, 'https://transparencia.senac.br/service/api/licitacoes/regional/rn');
    return ok(senacPayload(Array.from({ length: 12 }, (_, i) => ({ ...senacRecord, id: String(i) }))));
  } });
  const first = await source.fetchLatest({ pageSize: 10 });
  const last = await source.fetchLatest({ pageSize: 10, page: 2 });
  assert.equal(first.items.length, 10); assert.equal(first.hasMore, true);
  assert.equal(last.items.length, 2); assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.items, ...last.items].map(item => item.id)).size, 12);
  assert.equal(calls, 1);
  await source.fetchLatest({ pageSize: 10 }); assert.equal(calls, 2);
  await assert.rejects(source.fetchLatest({ page: 0 }), /Paginação/);
  assert.throws(() => createSenacSource({ regional: '../evil' }), /Regional/);
});

test('Sesc validates Brazilian dates, statuses and upstream pagination even when all page records are excluded', async () => {
  const items = normalizeSescItems([sescRecord, { ...sescRecord, SITUACAO: 'CONCLUÍDA' },
    { ...sescRecord, DT_ABERTURA_PROPOSTAS: '31/02/2026' }], 'CE');
  assert.equal(items.length, 1); assert.equal(items[0].dataAbertura, '2026-10-09T00:00:00-03:00');
  assert.equal(items[0].id, 'sesc:ce:2026:001/26-PG'); assert.equal(items[0].uf, 'CE');
  assert.equal(items[0].urlFonte, undefined);
  assert.equal(normalizeSescItems([{ ...sescRecord, DT_ABERTURA_PROPOSTAS: '9/1/2026' }], 'PE')[0].dataAbertura, '2026-01-09T00:00:00-03:00');
  const source = createSescSource({ id: 'portal-55', regional: 'CE', fetchImpl: async url => {
    assert.equal(url.searchParams.get('page_size'), '10');
    return ok({ registros: [{ ...sescRecord, SITUACAO: 'SUSPENSA' }], pagina_total: 2, pagina_atual: 1 });
  } });
  const result = await source.fetchLatest({ pageSize: 10 });
  assert.equal(result.count, 0); assert.equal(result.hasMore, true);
  const bad = createSescSource({ regional: 'CE', fetchImpl: async () => ok({ registros: [], pagina_total: 2, pagina_atual: 0 }) });
  await assert.rejects(bad.fetchLatest(), /inválido/);
});

test('Recife uses stable business IDs and local time, with CKAN offset and total pagination', async () => {
  const [item] = normalizeRecifeItems([recifeRecord]);
  assert.equal(item.dataAbertura, '2026-10-09T09:00:00-03:00');
  assert.equal(item.id, normalizeRecifeItems([{ ...recifeRecord, _id: 999 }])[0].id);
  assert.notEqual(item.id, normalizeRecifeItems([{ ...recifeRecord, comissaolicitacao: 'Comissão 2' }])[0].id);
  assert.equal(item.urlFonte, undefined);
  const source = createRecifeSource({ fetchImpl: async url => {
    assert.equal(url.searchParams.get('offset'), '10');
    assert.equal(url.searchParams.get('sort'), '_id asc');
    return ok({ success: true, result: { total: 21, records: [recifeRecord] } });
  } });
  assert.equal((await source.fetchLatest({ page: 2, pageSize: 10 })).hasMore, true);
  const bad = createRecifeSource({ fetchImpl: async () => ok({ success: false, error: {} }) });
  await assert.rejects(bad.fetchLatest(), /inválido/);
});

test('public sources register all 57 verified portals and schedule one task per snapshot without federal modality filters', () => {
  const config = { SYNC_ENABLED: 'true', COMPRASNET_ENABLED: 'true', PNCP_MODALIDADES: '6,7', COMPRASNET_MODALIDADES: '5' };
  const registry = createDefaultSourceRegistry(config);
  const catalog = listPortalSources(registry);
  assert.equal(catalog.length, 104);
  assert.equal(catalog.filter(source => source.integrated).length, 59);
  assert.equal(catalog.filter(source => source.integrated && source.collectionMode === 'snapshot').length, 57);
  const tasks = sourceTaskDefinitions(registry, config);
  assert.equal(tasks.length, 60);
  assert.equal(tasks.filter(task => !task.modalidade).length, 57);
  const disabled = createDefaultSourceRegistry({ ...config, SENAC_ENABLED: 'false', SESC_ENABLED: 'false', RECIFE_ENABLED: 'false' });
  assert.equal(disabled.listSources().length, 2);
  assert.equal(listPortalSources(disabled).filter(source => source.integrated).length, 59);
  assert.equal(createDefaultSourceRegistry({ ...config, SYNC_ENABLED: 'false' }).listSources().length, 0);
});

test('public APIs propagate HTTP failures instead of reporting an empty successful collection', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  for (const source of [createSenacSource({ regional: 'PB', fetchImpl }), createSescSource({ regional: 'PB', fetchImpl }), createRecifeSource({ fetchImpl })]) {
    await assert.rejects(source.fetchLatest(), /503/);
  }
});

test('worker persists a regional snapshot, resumes pagination and reimports without duplicating procurements', async () => {
  const db = new PGlite();
  let worker;
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    const query = (sql, values) => sql.includes('pg_try_advisory_lock') ? Promise.resolve({ rows: [{ locked: true }] }) :
      sql.includes('pg_advisory_unlock') ? Promise.resolve({ rows: [] }) : db.query(sql, values);
    const database = { query, connect: async () => ({ query, release() {} }) };
    let calls = 0;
    const source = createSenacSource({ id: 'portal-81', regional: 'RN', fetchImpl: async () => {
      calls++;
      return ok(senacPayload(Array.from({ length: 51 }, (_, i) => ({ ...senacRecord, id: String(i), objeto: `Notebook modelo ${i}` }))));
    } });
    worker = createOperationsService({ database, registry: createSourceRegistry({ 'portal-81': source }),
      config: { SYNC_LOOKBACK_DAYS: 2, SYNC_MAX_PAGES: 1, SYNC_INTERVAL_MINUTES: 60, EMAIL_ENABLED: 'false', WHATSAPP_ENABLED: 'false' },
      logger: { info() {}, error() {} } });
    const first = await worker.runOnce();
    assert.equal(first.results.find(result => result.name === 'sync:portal-81').inserted, 50);
    assert.equal((await db.query("SELECT cursor FROM tarefas WHERE nome='sync:portal-81'")).rows[0].cursor.page, 2);
    await db.exec('UPDATE tarefas SET proxima_execucao=now()');
    await worker.runOnce();
    assert.equal(calls, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM licitacoes_pncp')).rows[0].n, 51);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM licitacoes_pncp WHERE origem='portal-81' AND uf='RN'")).rows[0].n, 51);
    await db.exec('UPDATE tarefas SET proxima_execucao=now()');
    const repeat = await worker.runOnce();
    assert.equal(repeat.results.find(result => result.name === 'sync:portal-81').inserted, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM licitacoes_pncp')).rows[0].n, 51);
  } finally { await worker?.stop(); await db.close(); }
});
