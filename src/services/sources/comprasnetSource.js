const DEFAULT_COMPRASNET_URL = 'https://www.comprasnet.gov.br/consulta';

function readUnitName(value) {
  if (!value || typeof value !== 'object') return '';
  return String(value.nome || value.unidadeGestora || value.unidade_gestora || value.orgao || '').trim();
}

export function normalizeComprasnetItems(payload) {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.itens) ? payload.itens : Array.isArray(payload?.dados) ? payload.dados : [];
  return records
    .map(item => {
      const id = String(item?.numero || item?.id || item?.codigo || '').trim();
      const objeto = String(item?.descricao || item?.objeto || item?.titulo || '').trim();
      const rawDate = item?.dataAbertura || item?.data_abertura || item?.dataPublicacao || item?.data_publicacao || item?.data || '';
      const unidadeGestora = readUnitName(item?.orgao || item?.unidadeGestora || item?.unidade_gestora) || String(item?.unidadeGestora || item?.unidade_gestora || item?.orgao || '').trim();
      const modalidade = String(item?.modalidade || item?.tipo || item?.modalidadeNome || 'N/D').trim();

      if (!id || !objeto || !rawDate || !unidadeGestora) return null;

      return {
        id,
        objeto,
        dataAbertura: rawDate,
        unidadeGestora,
        modalidade: modalidade || 'N/D'
      };
    })
    .filter(Boolean);
}

export function createComprasnetSource({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_COMPRASNET_URL } = {}) {
  return {
    async fetchLatest(query = {}) {
      const url = new URL(baseUrl);
      const page = Number(query.page ?? 1);
      const pageSize = Number(query.pageSize ?? 20);
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', String(pageSize));
      if (query.termo) url.searchParams.set('termo', String(query.termo));
      if (query.modalidade) url.searchParams.set('modalidade', String(query.modalidade));

      const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response || typeof response.ok !== 'boolean') {
        throw new Error('Resposta inválida do portal complementar.');
      }

      const text = typeof response.text === 'function' ? await response.text() : '';
      if (!response.ok) {
        throw new Error(`Portal complementar falhou (${response.status || 500}): ${text || 'sem detalhe'}`);
      }

      const payload = typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(text || '{}');

      const items = normalizeComprasnetItems(payload);
      return { source: 'comprasnet', page, pageSize, count: items.length, items };
    }
  };
}
