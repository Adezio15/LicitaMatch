function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeItemSignature(item = {}) {
  const objeto = normalizeText(item.objeto || item.descricao || item.titulo || '');
  const unidade = normalizeText(item.unidadeGestora || item.unidade_gestora || item.orgao || item.orgaoNome || '');
  const rawDate = String(item.dataAbertura || item.data_abertura || item.data || '').trim();
  const data = rawDate ? rawDate.slice(0, 10) : '';
  const modalidade = normalizeText(item.modalidade || item.modalidadeNome || item.tipo || '');

  const seed = `${objeto}|${data}|${unidade}|${modalidade}`;
  if (seed && objeto && unidade && data) return seed;

  if (item.id) return `id:${normalizeText(String(item.id))}`;
  return 'empty';
}

export function deduplicateItems(items = []) {
  const seen = new Map();
  const unique = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.objeto && !item.descricao && !item.titulo) continue;

    const signature = normalizeItemSignature(item);
    if (seen.has(signature)) continue;

    seen.set(signature, true);
    unique.push({
      ...item,
      id: item.id ? String(item.id) : `dedup:${unique.length + 1}`,
      objeto: String(item.objeto || item.descricao || item.titulo || '').trim(),
      dataAbertura: item.dataAbertura || item.data_abertura || item.data || null,
      unidadeGestora: item.unidadeGestora || item.unidade_gestora || item.orgao || item.orgaoNome || '',
      modalidade: item.modalidade || item.modalidadeNome || item.tipo || 'N/D'
    });
  }

  return unique;
}
