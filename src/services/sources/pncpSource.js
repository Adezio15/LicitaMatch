const DEFAULT_PNCP_URL = 'https://pncp.gov.br/api/v1/consulta';

function readUnitName(value) {
  if (!value || typeof value !== 'object') return '';
  return String(value.nome || value.unidadeGestora || value.unidade_gestora || '').trim();
}

export function normalizePncpItems(payload) {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return records
    .map(item => {
      const id = String(item?.id || item?._id || item?.codigo || '').trim();
      const objeto = String(item?.objeto || item?.descricao || item?.titulo || '').trim();
      const rawDate = item?.dataAbertura || item?.data_abertura || item?.dataPublicacao || item?.data_publicacao || '';
      const unidadeGestora = readUnitName(item?.unidadeGestora || item?.unidade_gestora) || String(item?.unidadeGestora || item?.unidade_gestora || '').trim();
      const modalidade = String(item?.modalidade || item?.modalidadeNome || 'N/D').trim();

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

export function createPncpSource({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_PNCP_URL } = {}) {
  return {
    async fetchLatest(query = {}) {
      const url = new URL(baseUrl);
      const page = Number(query.page ?? 1);
      const pageSize = Number(query.pageSize ?? 20);
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', String(pageSize));
      if (query.termo) url.searchParams.set('termo', String(query.termo));

      const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response || typeof response.ok !== 'boolean') {
        throw new Error('Resposta inválida do PNCP.');
      }

      const text = typeof response.text === 'function' ? await response.text() : '';
      if (!response.ok) {
        throw new Error(`PNCP API falhou (${response.status || 500}): ${text || 'sem detalhe'}`);
      }

      const payload = typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(text || '{}');

      const items = normalizePncpItems(payload);
      return { source: 'pncp', page, pageSize, count: items.length, items };
    }
  };
}
