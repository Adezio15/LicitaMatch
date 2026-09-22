function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asWords(value) {
  const words = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [];
  return words
    .map(item => normalizeText(item))
    .filter(item => item && item.length > 2)
    .filter((item, index, all) => all.indexOf(item) === index);
}

export function matchLicitacao(licitacao, interesse = {}) {
  const search = normalizeText([
    licitacao?.objeto,
    licitacao?.modalidade,
    licitacao?.unidadeGestora,
    licitacao?.unidade_gestora
  ].join(' '));

  const keywords = asWords(interesse.palavras || interesse.titulo || '');
  if (!keywords.length || !search) return 0;

  const matches = keywords.filter(word => search.includes(word)).length;
  const score = Math.round((matches / keywords.length) * 100);
  return Math.min(100, Math.max(0, score));
}

export function matchRepository(database) {
  return {
    async listByInteresse(interesseId) {
      const { rows } = await database.query(`SELECT id, interesse_id, licitacao_id, empresa_id, score, status, created_at
        FROM matches WHERE interesse_id=$1 ORDER BY score DESC, created_at DESC`, [interesseId]);
      return rows;
    }
  };
}

export async function saveMatches(database, payload = {}) {
  const interesseId = Number(payload.interesseId ?? 0);
  const licitacaoId = Number(payload.licitacaoId ?? 0);
  const empresaId = Number(payload.empresaId ?? 0);
  if (!interesseId || !licitacaoId || !empresaId) return 0;

  const { rows } = await database.query(`SELECT id, objeto, modalidade, unidade_gestora AS "unidadeGestora"
    FROM licitacoes_pncp WHERE id=$1`, [licitacaoId]);
  const licitacao = rows[0];
  if (!licitacao) return 0;

  const score = matchLicitacao({
    objeto: licitacao.objeto,
    modalidade: licitacao.modalidade,
    unidadeGestora: licitacao.unidadeGestora
  }, { palavras: payload.palavras || [], titulo: payload.titulo || '' });

  const { rowCount } = await database.query(`INSERT INTO matches (interesse_id, licitacao_id, empresa_id, score, status)
    VALUES ($1, $2, $3, $4, 'novo')
    ON CONFLICT (interesse_id, licitacao_id) DO NOTHING`, [interesseId, licitacaoId, empresaId, score]);

  return rowCount || 0;
}
