import { createHash } from 'node:crypto';
import { createOfficialApiClient, createPncpLinkResolver, pncpIdentifiers } from './sources/officialLinkResolver.js';
import { extractOfficialLinks, procurementUrl } from './sources/officialLink.js';
import portals from './sources/portalCatalog.json' with { type: 'json' };
import { RECIFE_API, RECIFE_RESOURCE } from './sources/recifeSource.js';
import { sescApi } from './sources/sescSource.js';
import { SENAC_API } from './sources/senacSource.js';

export const priorityMatches = [39404, 38845, 39406, 39407, 21897, 22040];
const empty = value => value == null || value.trim() === '';
export const confirmationFor = manifest => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

export function createHistoricalLinkResolver({ api = createOfficialApiClient() } = {}) {
  const pncp = createPncpLinkResolver({ api });
  const snapshots = new Map();
  const cached = (key, load) => {
    if (!snapshots.has(key)) snapshots.set(key, load());
    return snapshots.get(key);
  };
  return async row => {
    try {
      if (['pncp', 'comprasnet'].includes(row.origem)) {
        if (!pncpIdentifiers(row)) return { status: 'identificador_nao_suportado' };
        return await pncp.resolve(row, { details: true });
      }
      const portal = portals.find(item => item.id === row.origem);
      if (!portal) return { status: 'fonte_nao_suportada' };
      let record, source;
      if (row.origem === 'portal-37') {
        const key = JSON.parse(row.codigo_externo.replace(/^recife:/, ''));
        if (!Array.isArray(key) || key.length !== 4) return { status: 'identificador_nao_suportado' };
        const filters = { orgaolicitante: key[0], comissaolicitacao: key[1],
          anoprocessolicitatorio: key[2], numeroprocessolicitatorio: key[3] };
        const url = new URL(RECIFE_API);
        url.searchParams.set('resource_id', RECIFE_RESOURCE);
        url.searchParams.set('filters', JSON.stringify(filters));
        url.searchParams.set('limit', '100');
        source = url.href;
        const payload = await cached(source, () => api.get(source));
        if (payload.success !== true || !Array.isArray(payload.result?.records)) throw new Error('invalid_payload');
        record = payload.result.records.find(item =>
          item.orgaolicitante === key[0] && item.comissaolicitacao === key[1] &&
          Number(item.anoprocessolicitatorio) === Number(key[2]) && Number(item.numeroprocessolicitatorio) === Number(key[3]));
      } else if (portal.name.startsWith('Senac ')) {
        const match = /^senac:([a-z]{2}):(.+)$/.exec(row.codigo_externo);
        if (!match || portal.name.split(' ')[1].toLowerCase() !== match[1]) return { status: 'identificador_nao_suportado' };
        source = SENAC_API + match[1];
        const payload = await cached(source, () => api.get(source));
        if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('invalid_payload');
        record = payload.data.flatMap(group => group.dadosModalidadeLicitacao || [])
          .find(item => String(item.id).trim() === match[2]);
      } else if (portal.name.startsWith('Sesc ')) {
        const match = /^sesc:([a-z]{2}):(\d{4}):(.+)$/.exec(row.codigo_externo);
        if (!match || !portal.name.startsWith(`Sesc ${match[1].toUpperCase()}`)) return { status: 'identificador_nao_suportado' };
        const base = sescApi(match[1]);
        // Cache each page. The shared API request budget also bounds pagination.
        for (let page = 1; page <= 50; page++) {
          source = `${base}?page=${page}&page_size=100`;
          const payload = await cached(source, () => api.get(source));
          if (!Array.isArray(payload.registros) || !Number.isInteger(payload.pagina_total) || payload.pagina_atual !== page) throw new Error('invalid_payload');
          record = payload.registros.find(item => String(item.ANO_LICITACAO) === match[2] &&
            String(item.NUMERO_PROCESSO || item.EDITAL || '').trim() === match[3]);
          if (record || page >= payload.pagina_total) break;
        }
      } else return { status: 'fonte_nao_suportada' };
      if (!record) return { status: 'registro_nao_localizado', source };
      const links = extractOfficialLinks(record);
      return { ...links, source, status: links.urlFonte ? 'encontrado' : 'ausente' };
    } catch {
      return { status: 'falha_consulta' };
    }
  };
}

export async function previewLinkRecovery(client, { resolve, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limite deve estar entre 1 e 500.');
  const { rows } = await client.query(`WITH prioridade AS (
      SELECT DISTINCT licitacao_id FROM matches
      WHERE empresa_id=1 AND score>=67 AND id=ANY($1::bigint[])
    )
    SELECT l.id,l.origem,l.codigo_externo,l.link_edital,l.url_fonte
    FROM licitacoes_pncp l LEFT JOIN prioridade p ON p.licitacao_id=l.id
    WHERE NULLIF(btrim(l.link_edital),'') IS NULL OR NULLIF(btrim(l.url_fonte),'') IS NULL
    ORDER BY CASE WHEN p.licitacao_id IS NOT NULL THEN 0 ELSE 1 END,l.id
    LIMIT $2`, [priorityMatches, limit]);
  const results = [], counters = { found: 0, rejected: 0, missing: 0, recovered: 0, failed: 0 };
  for (const row of rows) {
    // Existing valid links can fill the other empty field without any API request.
    const known = procurementUrl(row.link_edital) || procurementUrl(row.url_fonte);
    const result = known ? { link_edital: known, urlFonte: known, source: 'registro_existente', status: 'encontrado' }
      : await resolve(row);
    const link = procurementUrl(result.link_edital) || procurementUrl(result.urlFonte);
    const valid = !!link;
    counters.rejected += result.rejected || 0;
    if (valid) counters.found++; else counters.missing++;
    if (result.status === 'falha_consulta') counters.failed++;
    results.push({ id: row.id, origem: row.origem, codigo_externo: row.codigo_externo,
      source: result.source || null, status: result.status, valid,
      link_edital: empty(row.link_edital) ? link : null,
      url_fonte: empty(row.url_fonte) ? (procurementUrl(result.urlFonte) || link) : null });
  }
  return { results, counters };
}

export async function applyLinkRecovery(client, manifest, confirmation, databaseFingerprint) {
  if (confirmation !== confirmationFor(manifest) || manifest.version !== 1 ||
      manifest.database !== databaseFingerprint || !Array.isArray(manifest.results)) {
    throw new Error('Confirmação ou banco não corresponde à prévia.');
  }
  let recovered = 0;
  await client.query('BEGIN');
  try {
    for (const row of manifest.results) {
      if (!row.valid) continue;
      const edital = row.link_edital == null ? null : procurementUrl(row.link_edital);
      const fonte = row.url_fonte == null ? null : procurementUrl(row.url_fonte);
      if ((row.link_edital != null && !edital) || (row.url_fonte != null && !fonte)) throw new Error('URL inválida na prévia.');
      const result = await client.query(`UPDATE licitacoes_pncp SET
        link_edital=CASE WHEN NULLIF(btrim(link_edital),'') IS NULL THEN COALESCE($4,link_edital) ELSE link_edital END,
        url_fonte=CASE WHEN NULLIF(btrim(url_fonte),'') IS NULL THEN COALESCE($5,url_fonte) ELSE url_fonte END
        WHERE id=$1 AND origem=$2 AND codigo_externo=$3
          AND ((NULLIF(btrim(link_edital),'') IS NULL AND $4::text IS NOT NULL)
            OR (NULLIF(btrim(url_fonte),'') IS NULL AND $5::text IS NOT NULL)) RETURNING id`,
      [row.id, row.origem, row.codigo_externo, edital, fonte]);
      recovered += result.rows.length;
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  return { recovered };
}
