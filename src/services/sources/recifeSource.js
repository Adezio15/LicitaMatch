import { fetchJson, queryWindow } from './httpSource.js';
import { officialLink } from './officialLink.js';

export const RECIFE_API = 'https://dados.recife.pe.gov.br/api/3/action/datastore_search';
export const RECIFE_RESOURCE = '9771bedc-6f2e-43f0-bd4c-25b0de5500b5';

export function normalizeRecifeItems(records) {
  return records.map(record => {
    const orgao = String(record?.orgaolicitante || '').trim();
    const comissao = String(record?.comissaolicitacao || '').trim();
    const objeto = String(record?.objeto || '').trim();
    const year = Number(record?.anoprocessolicitatorio), number = Number(record?.numeroprocessolicitatorio);
    const date = record?.dataaberturaproposta;
    if (!orgao || !comissao || !objeto || !Number.isInteger(year) || year < 1900 ||
        !Number.isInteger(number) || number < 1 || typeof date !== 'string' || Number.isNaN(Date.parse(date))) return null;
    // The CKAN row index can change when the CSV is reloaded; use the business key.
    const id = `recife:${JSON.stringify([orgao, comissao, year, number])}`;
    const urlFonte = officialLink(record);
    const dataAbertura = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : `${date}-03:00`;
    return { id, objeto, dataAbertura, unidadeGestora: orgao,
      modalidade: String(record.modalidadeprocessolicitatorio || 'N/D'), uf: 'PE', cidade: 'Recife',
      ...(urlFonte ? { urlFonte } : {}) };
  }).filter(Boolean);
}

export function createRecifeSource({ fetchImpl = globalThis.fetch } = {}) {
  return { id: 'portal-37', name: 'Portal de Compras do Recife', collectionMode: 'snapshot',
    async fetchLatest(query = {}) {
      const { page, pageSize } = queryWindow(query);
      const url = new URL(RECIFE_API);
      url.searchParams.set('resource_id', RECIFE_RESOURCE);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String((page - 1) * pageSize));
      url.searchParams.set('sort', '_id asc');
      const payload = await fetchJson(fetchImpl, url, 'Recife');
      if (payload.success !== true || !Array.isArray(payload.result?.records) ||
          !Number.isInteger(payload.result.total) || payload.result.total < 0) throw new Error('Payload inválido do Recife.');
      const items = normalizeRecifeItems(payload.result.records);
      const totalPages = Math.ceil(payload.result.total / pageSize);
      return { source: 'portal-37', page, pageSize, count: items.length, items, totalPages, hasMore: page < totalPages };
    }
  };
}
