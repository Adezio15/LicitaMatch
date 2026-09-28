import { createHash } from 'node:crypto';
import { normalizeItemSignature } from './deduplicationService.js';
import { normalizeUf } from './sources/procurementMetadata.js';

export function pncpRepository(database) {
  return {
    async save(item) {
      // Reimports enrich old records; do not discard their newly available UF.
      const updated = await database.query(`UPDATE licitacoes_pncp SET uf=COALESCE($2,uf),
        modalidade=CASE WHEN $3='N/D' THEN modalidade ELSE $3 END
        WHERE codigo_externo=$1 RETURNING id`, [item.id, normalizeUf(item.uf), item.modalidade || 'N/D']);
      if (updated.rows.length) return null;
      const { rows } = await database.query(`INSERT INTO licitacoes_pncp (codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem, assinatura, uf)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
        RETURNING id, codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem`,
      [item.id, item.objeto, new Date(item.dataAbertura).toISOString(), item.unidadeGestora, item.modalidade || 'N/D', item.origem || 'pncp', createHash('sha256').update(normalizeItemSignature(item)).digest('hex'), normalizeUf(item.uf)]);
      return rows[0] || null;
    },
    async listLatest(limit = 200) {
      const { rows } = await database.query(`SELECT id, codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem, uf
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
      uf: normalizeUf(item.uf),
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
