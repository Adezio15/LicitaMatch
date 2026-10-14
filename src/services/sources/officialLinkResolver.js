import { setTimeout as delay } from 'node:timers/promises';
import { extractOfficialLinks } from './officialLink.js';

export function pncpIdentifiers(record = {}) {
  const code = String(record.numeroControlePNCP || record.codigo_externo || record.id || '');
  const match = /^(\d{14})-1-(\d{1,10})-(\d{4})$/.exec(code);
  const cnpj = record.orgaoEntidade?.cnpj || match?.[1];
  const ano = String(record.anoCompra || match?.[3] || '');
  const sequencial = String(record.sequencialCompra || match?.[2] || '').replace(/^0+(?=\d)/, '');
  if (!/^\d{14}$/.test(cnpj || '') || !/^\d{4}$/.test(ano) || !/^[1-9]\d{0,9}$/.test(sequencial)) return null;
  // When both forms are supplied, they must identify the same purchase.
  if (match && (cnpj !== match[1] || ano !== match[3] || sequencial !== String(Number(match[2])))) return null;
  return { cnpj, ano, sequencial };
}

// Only API URLs chosen by an adapter are fetched; candidate document URLs are never fetched.
export function createOfficialApiClient({ fetchImpl = globalThis.fetch, maxRequests = 50,
  intervalMs = 250, timeoutMs = 10000, maxDurationMs = 30000, maxBytes = 4 * 1024 * 1024 } = {}) {
  let requests = 0, lastRequest = 0;
  const startedAt = Date.now();
  return {
    get requests() { return requests; },
    async get(url) {
      if (requests >= maxRequests || Date.now() - startedAt >= maxDurationMs) throw new Error('request_limit');
      requests++;
      await delay(Math.max(0, lastRequest + intervalMs - Date.now()));
      lastRequest = Date.now();
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, maxDurationMs - (Date.now() - startedAt)))) });
      if (!response?.ok) throw new Error('official_api_failed');
      if (Number(response.headers?.get('content-length')) > maxBytes) throw new Error('response_too_large');
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = []; let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) throw new Error('response_too_large');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel(); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      return response.json();
    }
  };
}

export function createPncpLinkResolver({ api = createOfficialApiClient() } = {}) {
  const cache = new Map();
  return {
    async resolve(record, { details = false } = {}) {
      const ids = pncpIdentifiers(record);
      if (!ids) return { status: 'identificador_nao_suportado' };
      const key = `${ids.cnpj}/${ids.ano}/${ids.sequencial}/${details}`;
      if (cache.has(key)) return cache.get(key);
      const result = { status: 'ausente', source: null, link_edital: null, urlFonte: null, rejected: 0 };
      try {
        const path = `/v1/orgaos/${ids.cnpj}/compras/${ids.ano}/${ids.sequencial}`;
        const documentsUrl = `https://pncp.gov.br/api/pncp${path}/arquivos`;
        try {
          const payload = await api.get(documentsUrl);
          const documents = Array.isArray(payload) ? payload : payload?.documentos;
          if (!Array.isArray(documents)) throw new Error('invalid_documents');
          Object.assign(result, extractOfficialLinks({ documentos: documents }), { source: documentsUrl });
        } catch {
          if (!details) throw new Error('documents_unavailable');
        }
        if (!result.urlFonte && details) {
          const detailUrl = `https://pncp.gov.br/api/consulta${path}`;
          const detail = await api.get(detailUrl);
          // Check the returned identity before accepting any link from the detail.
          const identity = pncpIdentifiers(detail);
          if (!identity || JSON.stringify(identity) !== JSON.stringify(ids)) throw new Error('identity_mismatch');
          const detailLinks = extractOfficialLinks(detail);
          Object.assign(result, detailLinks, { rejected: result.rejected + detailLinks.rejected, source: detailUrl });
        }
        result.status = result.urlFonte ? 'encontrado' : 'ausente';
      } catch {
        result.status = 'falha_consulta';
      }
      // Bound cache memory; failed requests are cached too, avoiding repeated failures in a page.
      if (cache.size >= 500) cache.clear();
      cache.set(key, result);
      return result;
    }
  };
}
