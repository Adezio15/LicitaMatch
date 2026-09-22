import { fetchJson, queryWindow, unitName } from './httpSource.js';
const DEFAULT_PNCP_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

export function normalizePncpItems(payload) {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return records.map(item => {
    const id = String(item?.numeroControlePNCP || item?.id || item?._id || item?.codigo || '').trim();
    const objeto = String(item?.objetoCompra || item?.objeto || item?.descricao || item?.titulo || '').trim();
    const dataAbertura = item?.dataAberturaProposta || item?.dataAbertura || item?.data_abertura || item?.dataPublicacaoPncp || item?.dataPublicacao || item?.data_publicacao;
    const unidadeGestora = unitName(item?.unidadeOrgao || item?.unidadeGestora || item?.unidade_gestora || item?.orgaoEntidade);
    const modalidade = String(item?.modalidadeNome || item?.modalidade || 'N/D').trim();
    if (!id || !objeto || !unidadeGestora || !dataAbertura || Number.isNaN(Date.parse(dataAbertura))) return null;
    return { id,objeto,dataAbertura,unidadeGestora,modalidade: modalidade || 'N/D' };
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
