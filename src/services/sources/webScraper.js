export async function fetchHtml(fetchImpl, url, name = 'site') {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(30000)
  });

  if (!response || typeof response.ok !== 'boolean') {
    throw new Error(`Resposta inválida de ${name}.`);
  }
  if (!response.ok) {
    throw new Error(`${name} falhou (${response.status || 500}).`);
  }

  const text = typeof response.text === 'function' ? await response.text() : '';
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`${name} retornou HTML vazio.`);
  }

  return text;
}

export function parseTextBlocks(html) {
  const sanitized = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || '';
}

export function scrapeComprasnetHtml(html) {
  const text = parseTextBlocks(html);
  if (!text) return [];

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const find = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return normalize(match[1]);
    }
    return '';
  };

  const id = find([
    /(?:Processo|N[oº]?|No\.?|Número|Numero)[^0-9]{0,20}((?:\d{4}\/\d{1,6}(?:[-/.]\d+)*)|(?:[A-Z0-9]{2,}\/\d{1,6}(?:[-/.]\d+)*))/i,
    /(?:id|codigo|chave)[^0-9A-Z/.-]{0,20}((?:\d{4}\/\d{1,6}(?:[-/.]\d+)*)|(?:[A-Z0-9]{2,}\/\d{1,6}(?:[-/.]\d+)*))/i
  ]);

  const objeto = find([
    /(?:Objeto|Descrição|Descricao|Título|Titulo):?\s*([^\n.]{20,250})/i,
    /(?:Objeto|Descrição|Descricao|Título|Titulo)\s*[^A-Za-zÀ-ÿ0-9]{0,20}([A-Za-zÀ-ÿ0-9][^\n.]{20,250})/i
  ]);

  const unidadeGestora = find([
    /(?:Órgão|Orgao|Unidade Gestora|Entidade|UASG)[^A-Za-zÀ-ÿ0-9]{0,25}([A-Za-zÀ-ÿ0-9][^\n.]{8,200})/i,
    /(?:Órgão|Orgao|Unidade Gestora|Entidade)[^A-Za-zÀ-ÿ0-9]{0,20}([A-Za-zÀ-ÿ0-9][^\n.]{8,200})/i
  ]);

  const modalidade = find([
    /(?:Modalidade)[^A-Za-zÀ-ÿ0-9]{0,20}([A-Za-zÀ-ÿ0-9][^\n.]{4,120})/i,
    /(?:Pregão|Tomada de Preços|Concorrência|Dispensa|Inexigibilidade|Licitação)[^A-Za-zÀ-ÿ0-9]{0,20}([A-Za-zÀ-ÿ0-9][^\n.]{4,120})/i
  ]);

  const dataAbertura = find([
    /(?:Data\s+de\s+Abertura|Data\s+de\s+Publica[cç][aã]o|Abertura|Publica[cç][aã]o)[^0-9]{0,10}(\d{4}-\d{2}-\d{2})/i,
    /(\d{4}-\d{2}-\d{2})/i
  ]);

  if (!id || !objeto || !unidadeGestora || !dataAbertura || Number.isNaN(Date.parse(dataAbertura))) return [];

  return [{
    id,
    objeto: objeto.replace(/\s+([.,;:!?])/, '$1').trim(),
    unidadeGestora,
    modalidade: modalidade || 'N/D',
    dataAbertura
  }];
}

export async function scrapeComprasnetFallback({ fetchImpl, baseUrl, page = 1, pageSize = 50 } = {}) {
  const url = new URL(baseUrl);
  const html = await fetchHtml(fetchImpl, url, 'Portal complementar (scraping)');
  const items = scrapeComprasnetHtml(html);
  if (!items.length) {
    throw new Error('Scraping do portal complementar não encontrou registros válidos.');
  }

  return {
    source: 'comprasnet',
    page,
    pageSize,
    count: items.length,
    items,
    totalPages: page,
    hasMore: false,
    scraped: true
  };
}
