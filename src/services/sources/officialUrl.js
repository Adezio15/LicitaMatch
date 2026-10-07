// Only accept explicit links supplied by a source record. Never derive URLs from IDs.
export function validOfficialUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(text) || !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function officialUrlFromRecord(item) {
  // Document first, then procurement page, process page and source portal.
  for (const key of ['linkEdital', 'urlEdital', 'link_edital', 'urlOportunidade', 'url_oportunidade', 'linkProcessoEletronico', 'urlProcessoEletronico', 'linkSistemaOrigem']) {
    const url = validOfficialUrl(item?.[key]);
    if (url) return url;
  }
  return null;
}
