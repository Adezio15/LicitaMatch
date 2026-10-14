import { createOfficialApiClient, createPncpLinkResolver } from './officialLinkResolver.js';
import { officialUrlFromRecord } from './officialUrl.js';
import { fetchJson, queryWindow, unitName } from './httpSource.js';
import { normalizeUf, pncpModalidade } from './procurementMetadata.js';
import { officialLink, sourceCity, extractOfficialLinks } from './officialLink.js';
const DEFAULT_PNCP_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

export function normalizePncpItems(payload) {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return records.map(item => {
    const id = String(item?.numeroControlePNCP || item?.id || item?._id || item?.codigo || '').trim();
    const objeto = String(item?.objetoCompra || item?.objeto || item?.descricao || item?.titulo || '').trim();
    const dataAbertura = item?.dataAberturaProposta || item?.dataAbertura || item?.data_abertura || item?.dataPublicacaoPncp || item?.dataPublicacao || item?.data_publicacao;
    const unidadeGestora = unitName(item?.unidadeOrgao || item?.unidadeGestora || item?.unidade_gestora || item?.orgaoEntidade);
    const modalidade = pncpModalidade(item?.modalidadeId, item?.modalidadeNome || item?.modalidade);
    const uf = normalizeUf(item?.unidadeOrgao?.ufSigla || item?.uf);
    if (!id || !objeto || !unidadeGestora || !dataAbertura || Number.isNaN(Date.parse(dataAbertura))) return null;
    const urlFonte = officialLink(item);
    const link = officialUrlFromRecord(item);
    const cidade = sourceCity(item?.unidadeOrgao?.municipioNome || item?.cidade || item?.municipioNome);
    return { id,objeto,dataAbertura,unidadeGestora,modalidade, ...(uf ? { uf } : {}),
      ...(link ? { link_edital: link } : {}), ...(urlFonte ? { urlFonte } : {}), ...(cidade ? { cidade } : {}) };
  }).filter(Boolean);
}

export function createPncpSource({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_PNCP_URL, logger } = {}) {
  return { async fetchLatest(query = {}) {
    const { page,pageSize,start,end } = queryWindow(query);
    const url = new URL(baseUrl);
    url.searchParams.set('pagina',String(page));
    url.searchParams.set('tamanhoPagina',String(pageSize));
    url.searchParams.set('dataInicial',start.replaceAll('-',''));
    url.searchParams.set('dataFinal',end.replaceAll('-',''));
    url.searchParams.set('codigoModalidadeContratacao',String(query.modalidade || 6));
    const payload = await fetchJson(fetchImpl,url,'PNCP');
    if (!Array.isArray(payload) && !Array.isArray(payload.data)) throw new Error('Payload inválido do PNCP.');
    const items = normalizePncpItems(payload);
    const records = Array.isArray(payload) ? payload : payload.data;
    const byId = new Map(records.filter(record => record && typeof record === 'object').map(record => [String(record.numeroControlePNCP || record.id || record._id || record.codigo || '').trim(), record]));
    const resolver = createPncpLinkResolver({ api: createOfficialApiClient({ fetchImpl, maxRequests: 50 }) });
    const links = { found: 0, rejected: 0, missing: 0, recovered: 0, failed: 0 };
    for (const item of items) {
      links.rejected += extractOfficialLinks(byId.get(item.id)).rejected;
      if (item.urlFonte) { links.found++; continue; }
      const result = await resolver.resolve(byId.get(item.id), { details: true });
      links.rejected += result.rejected || 0;
      if (result.urlFonte) {
        item.urlFonte = result.urlFonte;
        item.link_edital = result.link_edital;
        links.found++; links.recovered++;
      } else {
        links.missing++;
        if (result.status === 'falha_consulta') links.failed++;
      }
    }
    logger?.info({ event: 'official_links.import', source: 'pncp', ...links }, 'Links oficiais na importação');
    return { source: 'pncp',page,pageSize,count: items.length,items,links,
      totalPages: Number(payload.totalPaginas ?? page), hasMore: payload.totalPaginas ? page < Number(payload.totalPaginas) : false };
  } };
}
