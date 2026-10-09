import { fetchJson, queryWindow } from './httpSource.js';
import { normalizeUf } from './procurementMetadata.js';
import { officialLink } from './officialLink.js';
import { validOfficialUrl } from './officialUrl.js';

export const SENAC_API = 'https://transparencia.senac.br/service/api/licitacoes/regional/';

export function normalizeSenacItems(payload, regional) {
  if (payload?.success !== true || !Array.isArray(payload.data) ||
      payload.data.some(group => !Array.isArray(group?.dadosModalidadeLicitacao))) {
    throw new Error('Payload inválido do Senac.');
  }
  const items = [];
  for (const group of payload.data) for (const record of group.dadosModalidadeLicitacao) {
    // The endpoint also includes cancelled, suspended and completed processes.
    if (record?.situacao !== 'Em processo') continue;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const objeto = typeof record.objeto === 'string' ? record.objeto.trim() : '';
    const dataAbertura = record.dataAbertura;
    if (!id || !objeto || typeof dataAbertura !== 'string' || Number.isNaN(Date.parse(dataAbertura))) continue;
    const documents = Array.isArray(record.documentos) ? record.documentos : [];
    const edital = documents.find(doc => doc?.ativo !== false &&
      /^edital\b/i.test(doc.tipoDocumento?.descricao || doc.nomeDocumento || '') &&
      validOfficialUrl(doc.arquivoLicitacao?.nomeArquivoFisico));
    // Preserve only explicit URLs. Relative storage paths are not public links.
    const urlFonte = officialLink(record) || validOfficialUrl(edital?.arquivoLicitacao?.nomeArquivoFisico);
    const uf = normalizeUf(regional);
    items.push({ id: `senac:${regional.toLowerCase()}:${id}`, objeto, dataAbertura,
      unidadeGestora: `Senac ${regional.toUpperCase()}`, modalidade: String(group.modalidade || 'N/D'),
      ...(uf ? { uf } : {}), ...(urlFonte ? { urlFonte, link_edital: urlFonte } : {}) });
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export function createSenacSource({ regional, id, fetchImpl = globalThis.fetch } = {}) {
  if (!/^(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|DN)$/i.test(regional || '')) {
    throw new Error('Regional inválida do Senac.');
  }
  let snapshot, loadedAt = 0;
  return { id, name: `Senac ${regional.toUpperCase()}`, collectionMode: 'snapshot',
    async fetchLatest(query = {}) {
      const { page, pageSize } = queryWindow(query);
      // This official API exposes a full snapshot, with no date/page filters.
      // Reuse it during pagination to avoid downloading it for every local page.
      if (!snapshot || page === 1 || Date.now() - loadedAt > 300000) {
        snapshot = normalizeSenacItems(await fetchJson(fetchImpl, `${SENAC_API}${regional.toLowerCase()}`, 'Senac'), regional);
        loadedAt = Date.now();
      }
      const totalPages = Math.ceil(snapshot.length / pageSize);
      const items = snapshot.slice((page - 1) * pageSize, page * pageSize);
      return { source: id, page, pageSize, count: items.length, items, totalPages, hasMore: page < totalPages };
    }
  };
}
