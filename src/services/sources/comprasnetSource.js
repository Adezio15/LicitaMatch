import { officialUrlFromRecord } from './officialUrl.js';
import { fetchJson, queryWindow, unitName } from './httpSource.js';
import { scrapeComprasnetFallback } from './webScraper.js';
import { normalizeUf, pncpModalidade } from './procurementMetadata.js';
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
    const modalidade = pncpModalidade(item?.modalidadeIdPncp, item?.modalidadeNome || item?.modalidade || item?.tipo);
    const uf = normalizeUf(item?.unidadeOrgaoUfSigla || item?.unidadeOrgao?.ufSigla || item?.uf);
    if (!id || !objeto || !unidadeGestora || !dataAbertura || Number.isNaN(Date.parse(dataAbertura))) return null;
    const link = officialUrlFromRecord(item);
    return { id,objeto,dataAbertura,unidadeGestora,modalidade, ...(link ? { link_edital: link } : {}), ...(uf ? { uf } : {}) };
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

    try {
      const payload = await fetchJson(fetchImpl,url,'Portal complementar');
      const records = Array.isArray(payload) ? payload : payload?.resultado || payload?.itens || payload?.dados || [];
      if (!Array.isArray(records)) throw new Error('Payload inválido do Compras.gov.br.');
      if (!records.length) return { source: 'comprasnet', page, pageSize, count: 0, items: [], totalPages: Number(payload.totalPaginas || 0), hasMore: false };
      const items = normalizeComprasnetItems(payload);
      return { source: 'comprasnet',page,pageSize,count: items.length,items,
        totalPages: Number(payload.totalPaginas ?? page), hasMore: payload.totalPaginas ? page < Number(payload.totalPaginas) : false };
    } catch (error) {
      try {
        const fallback = await scrapeComprasnetFallback({ fetchImpl, baseUrl: url.toString(), page, pageSize });
        return fallback;
      } catch (fallbackError) {
        const message = fallbackError?.message || error?.message || 'Portal complementar indisponível.';
        throw new Error(`${error?.message || 'Portal complementar indisponível.'}. Scraping do portal complementar falhou: ${message}`);
      }
    }
  } };
}
