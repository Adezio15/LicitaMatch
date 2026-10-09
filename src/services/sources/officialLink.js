// URLs must come from the source payload or an actually fetched HTML page.
// Never construct a portal URL from a procurement identifier.
export function safeOfficialUrl(value, base) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 4096 || /[\s\u0000-\u001f\u007f\\]/u.test(text)) return null;
  if (!base && !/^https?:\/\//i.test(text)) return null;
  try {
    const url = base ? new URL(text, base) : new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 4096) return null;
    return base ? url.href : text;
  } catch { return null; }
}

export function officialLink(item = {}) {
  const candidates = [item.urlEdital, item.linkEdital, item.urlContratacao, item.linkContratacao,
    item.linkProcessoEletronico, item.urlProcessoEletronico, item.linkSistemaOrigem,
    item.urlPncp, item.linkPncp, item.url_fonte, item.urlFonte, item.url, item.link]
    .map(value => safeOfficialUrl(value)).filter(Boolean);
  // A record/process page is more useful than a portal's home page.
  return candidates.find(value => { const url = new URL(value); return url.pathname !== '/' || url.search || url.hash; })
    || candidates[0] || null;
}

export function sourceCity(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}
