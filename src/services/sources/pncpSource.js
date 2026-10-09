import { officialUrlFromRecord } from './officialUrl.js';
import { fetchJson, queryWindow, unitName } from './httpSource.js';
import { normalizeUf, pncpModalidade } from './procurementMetadata.js';
import { officialLink, sourceCity } from './officialLink.js';
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

export function createPncpSource({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_PNCP_URL } = {}) {
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
    return { source: 'pncp',page,pageSize,count: items.length,items,
      totalPages: Number(payload.totalPaginas ?? page), hasMore: payload.totalPaginas ? page < Number(payload.totalPaginas) : false };
  } };
}
