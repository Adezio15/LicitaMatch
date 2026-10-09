import { fetchJson, queryWindow } from './httpSource.js';
import { normalizeUf } from './procurementMetadata.js';
import { officialLink } from './officialLink.js';

export function sescApi(regional) {
  if (!/^(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|DN)$/i.test(regional || '')) {
    throw new Error('Regional inválida do Sesc.');
  }
  return `https://transparencia-${regional.toLowerCase()}.sesc.com.br/transparencia/dados/api/216`;
}

function openingDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  return `${date}T00:00:00-03:00`;
}

export function normalizeSescItems(records, regional) {
  return records.map(record => {
    if (record?.SITUACAO !== 'EM ANDAMENTO') return null;
    const number = String(record.NUMERO_PROCESSO || record.EDITAL || '').trim();
    const year = String(record.ANO_LICITACAO || '').trim();
    const objeto = String(record.DESC_OBJETO || '').trim();
    const dataAbertura = openingDate(record.DT_ABERTURA_PROPOSTAS);
    if (!number || !/^\d{4}$/.test(year) || !objeto || !dataAbertura) return null;
    const uf = normalizeUf(regional);
    const urlFonte = officialLink(record);
    return { id: `sesc:${regional.toLowerCase()}:${year}:${number}`, objeto, dataAbertura,
      unidadeGestora: `Sesc ${regional.toUpperCase()}`, modalidade: String(record.MOD_LICITACAO || 'N/D'),
      ...(uf ? { uf } : {}), ...(urlFonte ? { urlFonte } : {}) };
  }).filter(Boolean);
}

export function createSescSource({ id, regional, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = sescApi(regional);
  return { id, name: `Sesc ${regional.toUpperCase()}`, collectionMode: 'snapshot',
    async fetchLatest(query = {}) {
      const { page, pageSize } = queryWindow(query);
      const url = new URL(baseUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(pageSize));
      const payload = await fetchJson(fetchImpl, url, 'Sesc');
      if (!Array.isArray(payload.registros) || !Number.isInteger(payload.pagina_total) ||
          payload.pagina_total < 0 || payload.pagina_atual !== page) throw new Error('Payload inválido do Sesc.');
      const items = normalizeSescItems(payload.registros, regional);
      return { source: id, page, pageSize, count: items.length, items,
        totalPages: payload.pagina_total, hasMore: page < payload.pagina_total };
    }
  };
}
