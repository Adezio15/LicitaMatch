import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { persistPncpItems } from '../src/services/pncpPersistenceService.js';
import { extractOfficialLinks, officialLink } from '../src/services/sources/officialLink.js';
import { officialUrlFromRecord } from '../src/services/sources/officialUrl.js';
import { createOfficialApiClient, createPncpLinkResolver, pncpIdentifiers } from '../src/services/sources/officialLinkResolver.js';
import { createPncpSource } from '../src/services/sources/pncpSource.js';
import { createHistoricalLinkResolver, previewLinkRecovery, applyLinkRecovery, confirmationFor } from '../src/services/officialLinkRecoveryService.js';

const code = '12345678000199-1-000042-2026';
const url = 'https://pncp.gov.br/arquivos/edital-42.pdf';
const item = { id: code, objeto: 'Compra de notebook', dataAbertura: '2026-10-10', unidadeGestora: 'Secretaria', modalidade: 'Pregão Eletrônico' };
const ok = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const edital = { tipoDocumentoNome: 'Edital', url };
const apiFor = fetchImpl => createOfficialApiClient({ fetchImpl, intervalMs: 0 });

test('extratores compartilham aliases, preferem edital e rejeitam homepage, credenciais e anexos arbitrários', () => {
  for (const field of ['urlOportunidade', 'link_edital', 'urlPncp', 'url_fonte']) {
    assert.equal(officialLink({ [field]: url }), url);
    assert.equal(officialUrlFromRecord({ [field]: url }), url);
  }
  const result = extractOfficialLinks({ linkSistemaOrigem: 'https://portal.gov.br/processo/42', documentos: [edital] });
  assert.equal(result.link_edital, url);
  assert.equal(result.urlFonte, url);
  assert.equal(officialLink({ documentos: [{ ...edital, ativo: false }] }), null);
  assert.equal(officialLink({ documentos: [{ tipoDocumentoNome: 'Ata', url }] }), null);
  for (const bad of ['https://portal.gov.br/', 'https://user:pass@portal.gov.br/x', '/edital.pdf', 'javascript:x', 'https://portal.gov.br/a\u00a0b']) {
    const result = extractOfficialLinks({ urlEdital: bad });
    assert.equal(result.urlFonte, null); assert.equal(result.rejected, 1);
  }
});

test('PNCP usa identificadores reais, retorna URL fornecida e cache evita repetição', async () => {
  let calls = 0;
  const resolver = createPncpLinkResolver({ api: apiFor(async endpoint => {
    calls++; assert.equal(endpoint, 'https://pncp.gov.br/api/pncp/v1/orgaos/12345678000199/compras/2026/42/arquivos');
    return ok([edital]);
  }) });
  assert.equal((await resolver.resolve({ id: code })).urlFonte, url);
  assert.equal((await resolver.resolve({ id: code })).urlFonte, url);
  assert.equal(calls, 1);
  assert.equal((await resolver.resolve({ id: 'guessed-42' })).status, 'identificador_nao_suportado');
  assert.equal(pncpIdentifiers({ id: code, orgaoEntidade: { cnpj: '00000000000000' } }), null);
});

test('consulta de detalhe só aceita identidade correspondente e usa página explícita', async () => {
  const endpoint = 'https://portal.gov.br/processo/42';
  const resolve = createHistoricalLinkResolver({ api: apiFor(async request => request.endsWith('/arquivos')
    ? ok([]) : ok({ numeroControlePNCP: code, linkSistemaOrigem: endpoint })) });
  const result = await resolve({ origem: 'comprasnet', codigo_externo: code });
  assert.equal(result.urlFonte, endpoint);
  assert.match(result.source, /api\/consulta/);
  const mismatch = createPncpLinkResolver({ api: apiFor(async request => request.endsWith('/arquivos')
    ? ok([]) : ok({ numeroControlePNCP: code.replace('000042', '000043'), urlEdital: url })) });
  assert.equal((await mismatch.resolve({ id: code }, { details: true })).status, 'falha_consulta');
});

test('limites, timeout, resposta excessiva e falhas não interrompem a importação', async () => {
  const api = createOfficialApiClient({ maxRequests: 1, intervalMs: 0, fetchImpl: async () => ok([]) });
  await api.get('https://pncp.gov.br/consulta');
  await assert.rejects(api.get('https://pncp.gov.br/consulta'), /request_limit/);
  const large = createOfficialApiClient({ maxBytes: 4, intervalMs: 0, fetchImpl: async () => ok([edital]) });
  await assert.rejects(large.get('https://pncp.gov.br/consulta'), /response_too_large/);
  const timeout = createOfficialApiClient({ timeoutMs: 5, intervalMs: 0, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
  } });
  const keepAlive = setTimeout(() => {}, 50);
  await assert.rejects(timeout.get('https://pncp.gov.br/consulta'), /timeout/); clearTimeout(keepAlive);
  const source = createPncpSource({ fetchImpl: async request => {
    if (String(request).includes('/arquivos')) throw new Error('offline');
    return ok({ data: [item], totalPaginas: 1 });
  } });
  const result = await source.fetchLatest();
  assert.equal(result.items.length, 1); assert.equal(result.links.failed, 1);
});

test('importação complementa PNCP sem links e evita consultas quando há URL conhecida', async () => {
  let calls = 0;
  const source = createPncpSource({ fetchImpl: async request => {
    calls++;
    return String(request).includes('/arquivos') ? ok([edital])
      : ok({ data: [item, { ...item, id: 'outro', urlEdital: url }], totalPaginas: 1 });
  } });
  const result = await source.fetchLatest();
  assert.equal(calls, 2); assert.equal(result.links.recovered, 1);
  assert.ok(result.items.every(row => row.urlFonte === url && row.link_edital === url));
});

test('histórico Senac recupera processos encerrados e reutiliza snapshot; Recife verifica chave completa', async () => {
  let calls = 0;
  const resolve = createHistoricalLinkResolver({ api: apiFor(async request => {
    calls++;
    if (request.includes('senac')) return ok({ success: true, data: [{ dadosModalidadeLicitacao: [
      { id: 'abc', situacao: 'Finalizada', documentos: [edital] }] }] });
    return ok({ success: true, result: { records: [{ orgaolicitante: 'Órgão', comissaolicitacao: 'CPL',
      anoprocessolicitatorio: 2026, numeroprocessolicitatorio: 42, urlEdital: url }] } });
  }) });
  const senac = { origem: 'portal-81', codigo_externo: 'senac:rn:abc' };
  assert.equal((await resolve(senac)).urlFonte, url);
  assert.equal((await resolve(senac)).urlFonte, url); assert.equal(calls, 1);
  assert.equal((await resolve({ origem: 'portal-37', codigo_externo: 'recife:["Órgão","CPL",2026,42]' })).urlFonte, url);
  assert.equal((await resolve({ origem: 'desconhecida', codigo_externo: code })).status, 'fonte_nao_suportada');
});

test('prévia prioriza matches, não escreve; aplicação exige confirmação, preserva concorrência e é idempotente', async () => {
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await persistPncpItems(db, [item, { ...item, id: 'second', objeto: 'Outro objeto' }]);
    await db.exec("INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Empresa','12345678000199','x@example.test','premium'); INSERT INTO interesses (empresa_id,titulo) VALUES (1,'Informática'); INSERT INTO matches (id,empresa_id,interesse_id,licitacao_id,score) OVERRIDING SYSTEM VALUE VALUES (39404,1,1,2,75)");
    const before = (await db.query('SELECT * FROM licitacoes_pncp ORDER BY id')).rows;
    let lookups = 0;
    const preview = await previewLinkRecovery(db, { resolve: async () => { lookups++; return { status: 'encontrado', source: 'https://pncp.gov.br/api/pncp', link_edital: url, urlFonte: url }; } });
    assert.equal(preview.results[0].id, 2); assert.equal(lookups, 2);
    assert.deepEqual((await db.query('SELECT * FROM licitacoes_pncp ORDER BY id')).rows, before);
    const manifest = { version: 1, database: 'local-test', ...preview };
    await assert.rejects(applyLinkRecovery(db, manifest, 'wrong', 'local-test'), /Confirmação/);
    await assert.rejects(applyLinkRecovery(db, manifest, confirmationFor(manifest), 'other-db'), /Confirmação/);
    const existing = 'https://portal.gov.br/edital/concorrente';
    await db.query('UPDATE licitacoes_pncp SET link_edital=$1 WHERE id=1', [existing]);
    assert.equal((await applyLinkRecovery(db, manifest, confirmationFor(manifest), 'local-test')).recovered, 2);
    assert.equal((await db.query('SELECT link_edital FROM licitacoes_pncp WHERE id=1')).rows[0].link_edital, existing);
    assert.equal((await applyLinkRecovery(db, manifest, confirmationFor(manifest), 'local-test')).recovered, 0);
    const noLookup = await previewLinkRecovery(db, { resolve: async () => { throw new Error('unexpected API call'); } });
    assert.equal(noLookup.results.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM licitacoes_pncp')).rows[0].total, 2);
  } finally { await db.close(); }
});

test('Sesc histórico pagina sem filtrar encerrados; mantém fonte da página encontrada', async () => {
  const seen = [];
  const resolve = createHistoricalLinkResolver({ api: apiFor(async request => {
    seen.push(request);
    const page = Number(new URL(request).searchParams.get('page'));
    return ok({ pagina_atual: page, pagina_total: 2, registros: page === 1 ? [] : [
      { ANO_LICITACAO: '2026', NUMERO_PROCESSO: '42', SITUACAO: 'CONCLUÍDA', documentos: [edital] }] });
  }) });
  const result = await resolve({ origem: 'portal-69', codigo_externo: 'sesc:rn:2026:42' });
  assert.equal(result.urlFonte, url); assert.equal(seen.length, 2); assert.match(result.source, /page=2/);
});

test('falha nos documentos permite página oficial comprovada; falhas e identidade divergente não inventam links', async () => {
  const resolver = createPncpLinkResolver({ api: apiFor(async request => {
    if (request.endsWith('/arquivos')) throw new Error('offline');
    return ok({ numeroControlePNCP: code, linkSistemaOrigem: 'https://portal.gov.br/contratacao/42' });
  }) });
  assert.equal((await resolver.resolve({ id: code }, { details: true })).urlFonte, 'https://portal.gov.br/contratacao/42');
  const failed = createHistoricalLinkResolver({ api: apiFor(async () => { throw new Error('offline'); }) });
  assert.equal((await failed({ origem: 'pncp', codigo_externo: code })).status, 'falha_consulta');
  assert.equal((await failed({ origem: 'comprasnet', codigo_externo: 'sem-chave-pncp' })).status, 'identificador_nao_suportado');
});

test('aplicação faz rollback integral se uma proposta for inválida', async () => {
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await persistPncpItems(db, [item]);
    const row = { id: 1, origem: 'pncp', codigo_externo: code, valid: true, link_edital: url, url_fonte: url };
    const manifest = { version: 1, database: 'local', results: [row, { ...row, link_edital: 'javascript:bad' }] };
    await assert.rejects(applyLinkRecovery(db, manifest, confirmationFor(manifest), 'local'), /URL inválida/);
    assert.equal((await db.query('SELECT link_edital FROM licitacoes_pncp')).rows[0].link_edital, null);
  } finally { await db.close(); }
});
