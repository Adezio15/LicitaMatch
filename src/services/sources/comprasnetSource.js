import { fetchJson, queryWindow, unitName } from './httpSource.js';
const DEFAULT_COMPRASNET_URL = 'https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133';

export function normalizeComprasnetItems(payload) {
  const records = Array.isArray(payload) ? payload : payload?.resultado || payload?.itens || payload?.dados || [];
  if (!Array.isArray(records)) return [];
  return records.map(item => {
    if (item?.contratacaoExcluida === true) return null;
    const id = String(item?.numeroControlePNCP || item?.idCompra || item?.numero || item?.id || item?.codigo || '').trim();
    const objeto = String(item?.objetoCompra || item?.descricao || item?.objeto || item?.titulo || '').trim();
    const dataAbertura = item?.dataAberturaPropostaPncp || item?.dataAbertura || item?.data_abertura || item?.dataPublicacaoPncp || item?.dataPublicacao || item?.data_publicacao || item?.data;
    const unidadeGestora = unitName(item?.unidadeOrgaoNomeUnidade || item?.orgaoEntidadeRazaoSocial || item?.orgao || item?.unidadeGestora || item?.unidade_gestora);
    const modalidade = String(item?.modalidadeNome || item?.modalidade || item?.tipo || 'N/D').trim();
    if (!id || !objeto || !unidadeGestora || !dataAbertura || Number.isNaN(Date.parse(dataAbertura))) return null;
    return { id,objeto,dataAbertura,unidadeGestora,modalidade: modalidade || 'N/D' };
  }).filter(Boolean);
}

export function createComprasnetSource({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_COMPRASNET_URL } = {}) {
  return { async fetchLatest(query = {}) {
    const { page,pageSize,start,end } = queryWindow(query);
    const url = new URL(baseUrl);
    url.searchParams.set('pagina',String(page));
    url.searchParams.set('tamanhoPagina',String(pageSize));
    url.searchParams.set('dataPublicacaoPncpInicial',start);
    url.searchParams.set('dataPublicacaoPncpFinal',end);
    url.searchParams.set('codigoModalidade',String(query.modalidade || 5));
    const payload = await fetchJson(fetchImpl,url,'Portal complementar');
    if (!Array.isArray(payload) && ![payload.resultado,payload.itens,payload.dados].some(Array.isArray)) throw new Error('Payload inválido do portal complementar.');
    const items = normalizeComprasnetItems(payload);
    return { source: 'comprasnet',page,pageSize,count: items.length,items,
      totalPages: Number(payload.totalPaginas ?? page), hasMore: payload.totalPaginas ? page < Number(payload.totalPaginas) : false };
  } };
}
