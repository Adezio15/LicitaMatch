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

// A homepage is not evidence for a particular procurement.
export function procurementUrl(value) {
  const link = safeOfficialUrl(value);
  if (!link) return null;
  const url = new URL(link);
  return url.pathname !== '/' || url.search || url.hash ? link : null;
}

const documentKeys = ['urlEdital', 'linkEdital', 'link_edital'];
const pageKeys = ['urlContratacao', 'linkContratacao', 'urlOportunidade', 'url_oportunidade',
  'linkProcessoEletronico', 'urlProcessoEletronico', 'linkSistemaOrigem',
  'urlPncp', 'linkPncp', 'url_fonte', 'urlFonte', 'url', 'link'];

export function extractOfficialLinks(item = {}) {
  if (!item || typeof item !== 'object') item = {};
  let rejected = 0;
  const accept = value => {
    const url = procurementUrl(value);
    if (typeof value === 'string' && value.trim() && !url) rejected++;
    return url;
  };
  const documents = [item.documentos, item.arquivos, item.documents].filter(Array.isArray).flat();
  const candidates = documents.filter(doc => doc && doc.ativo !== false && doc.statusAtivo !== false)
    .map(doc => ({
      edital: /^(edital|aviso de contrata[cç][aã]o direta)\b/i.test(
        doc.tipoDocumentoNome || doc.tipoDocumento?.descricao || doc.nomeDocumento || doc.titulo || ''),
      url: [doc.url, doc.urlDocumento, doc.link, doc.arquivoLicitacao?.nomeArquivoFisico]
        .map(accept).find(Boolean)
    }));
  // Never treat an arbitrary attachment (e.g. ata) as the edital.
  const edital = documentKeys.map(key => accept(item[key])).find(Boolean)
    || candidates.find(doc => doc.edital && doc.url)?.url || null;
  const page = pageKeys.map(key => accept(item[key])).find(Boolean) || null;
  const url = edital || page;
  return { link_edital: edital || page, urlFonte: url, rejected };
}

export function officialLink(item = {}) {
  return extractOfficialLinks(item).urlFonte;
}

export function sourceCity(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}
