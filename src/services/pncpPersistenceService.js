import { validOfficialUrl } from './sources/officialUrl.js';
import { createHash } from 'node:crypto';
import { normalizeItemSignature } from './deduplicationService.js';
import { normalizeUf } from './sources/procurementMetadata.js';
import { safeOfficialUrl, sourceCity } from './sources/officialLink.js';

export function pncpRepository(database) {
  return {
    async save(item) {
      // Enrich both exact IDs and duplicates found by signature without losing known metadata.
      const signature = createHash('sha256').update(normalizeItemSignature(item)).digest('hex');
      const enrich = () => database.query(`UPDATE licitacoes_pncp SET uf=COALESCE($2,uf),
        modalidade=CASE WHEN $3='N/D' THEN modalidade ELSE $3 END,
        url_fonte=CASE WHEN $4::text IS NULL THEN url_fonte
          WHEN url_fonte IS NOT NULL AND url_fonte !~* '^https?://[^/?#]+/?$' AND $4 ~* '^https?://[^/?#]+/?$' THEN url_fonte
          ELSE $4 END, cidade=COALESCE($5,cidade), link_edital=COALESCE($7,link_edital)
        WHERE id=(SELECT id FROM licitacoes_pncp WHERE codigo_externo=$1 OR (assinatura=$6 AND COALESCE(uf,'')=COALESCE($2,''))
          ORDER BY (codigo_externo=$1) DESC,id LIMIT 1) RETURNING id`,
      [item.id, normalizeUf(item.uf), item.modalidade || 'N/D', safeOfficialUrl(item.urlFonte), sourceCity(item.cidade), signature, validOfficialUrl(item.link_edital)]);
      const updated = await enrich();
      if (updated.rows.length) return null;
      const { rows } = await database.query(`INSERT INTO licitacoes_pncp (codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem, assinatura, uf, url_fonte, cidade, link_edital)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
        RETURNING id, codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem`,
      [item.id, item.objeto, new Date(item.dataAbertura).toISOString(), item.unidadeGestora, item.modalidade || 'N/D', item.origem || 'pncp', signature, normalizeUf(item.uf), safeOfficialUrl(item.urlFonte), sourceCity(item.cidade), validOfficialUrl(item.link_edital)]);
      if (!rows.length) await enrich(); // A concurrent importer may have won the insert.
      return rows[0] || null;
    },
    async listLatest(limit = 200) {
      const { rows } = await database.query(`SELECT id, codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem, uf, url_fonte, cidade, link_edital
        FROM licitacoes_pncp ORDER BY data_abertura DESC, id DESC LIMIT $1`, [limit]);
      return rows;
    }
  };
}

export async function persistPncpItems(database, items = [], origem = 'pncp') {
  const list = Array.isArray(items) ? items : [];
  const repo = pncpRepository(database);
  let inserted = 0;

  for (const item of list) {
    if (!item || !item.id || !item.objeto || !item.dataAbertura || !item.unidadeGestora) continue;
    const normalized = {
      origem,
      link_edital: validOfficialUrl(item.link_edital),
      uf: normalizeUf(item.uf),
      urlFonte: safeOfficialUrl(item.urlFonte || item.url_fonte),
      cidade: sourceCity(item.cidade),
      id: String(item.id).trim(),
      objeto: String(item.objeto).trim(),
      dataAbertura: String(item.dataAbertura).trim(),
      unidadeGestora: String(item.unidadeGestora).trim(),
      modalidade: String(item.modalidade || 'N/D').trim() || 'N/D'
    };
    if (!normalized.id || !normalized.objeto || !normalized.dataAbertura || !normalized.unidadeGestora) continue;
    const validDate = new Date(normalized.dataAbertura);
    if (Number.isNaN(validDate.getTime())) continue;

    const saved = await repo.save(normalized);
    if (saved) inserted += 1;
  }

  return inserted;
}
