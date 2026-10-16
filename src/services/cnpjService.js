import { cnpjSchema, states } from '../utils/validation.js';
import { HttpError } from '../utils/httpError.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function normalizeCompany(data, cnpj) {
  if (!data || typeof data !== 'object' || cnpjSchema.safeParse(data.cnpj).data !== cnpj || !clean(data.razao_social)) throw new HttpError(502, 'Resposta inválida da BrasilAPI. Tente novamente.');
  const code = String(data.cnae_fiscal ?? '').padStart(7, '0');
  return {
    cnpj, razao_social: clean(data.razao_social), nome_fantasia: clean(data.nome_fantasia),
    situacao_cadastral: clean(data.descricao_situacao_cadastral, 100),
    logradouro: clean([data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ')),
    numero: clean(data.numero, 30), complemento: clean(data.complemento), bairro: clean(data.bairro, 100),
    cep: /^\d{8}$/.test(String(data.cep ?? '').replace(/\D/g, '')) ? String(data.cep).replace(/\D/g, '') : '',
    cidade: clean(data.municipio, 100), estado: states.includes(data.uf) ? data.uf : '',
    telefone: clean(data.ddd_telefone_1, 30), email_empresa: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '') ? clean(data.email, 254).toLowerCase() : '',
    cnae_principal: /^\d{7}$/.test(code) && Number(code) > 0 ? code : '', cnae_descricao: clean(data.cnae_fiscal_descricao, 1000)
  };
}

// Cache limitado por processo: não contém registros privados do LicitaMatch.
export function cnpjService({ fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 3600000, timeoutMs = 8000, maxEntries = 500, maxConcurrent = 10 } = {}) {
  const cache = new Map();
  const pending = new Map();
  return { async lookup(input) {
    const parsed = cnpjSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(422, 'CNPJ inválido. Confira os caracteres e dígitos verificadores.');
    const cnpj = parsed.data;
    const hit = cache.get(cnpj);
    if (hit && hit.expires > now()) return { ...hit.value, cached: true };
    cache.delete(cnpj);
    if (pending.has(cnpj)) return pending.get(cnpj);
    if (pending.size >= maxConcurrent) throw new HttpError(429, 'Consultas ocupadas. Tente novamente em instantes.');
    const task = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HttpError(504, 'A consulta de CNPJ demorou demais. Tente novamente.')); }, timeoutMs); });
        const value = await Promise.race([timeout, (async () => {
          const response = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: controller.signal, headers: { Accept: 'application/json' }, redirect: 'error' });
          if (response.status === 404) throw new HttpError(404, 'CNPJ não encontrado na BrasilAPI. Você pode preencher os dados manualmente.');
          if (response.status === 429) throw new HttpError(429, 'Limite da BrasilAPI atingido. Tente novamente mais tarde.');
          if (response.status === 400) throw new HttpError(422, 'A BrasilAPI não aceitou este CNPJ. Você pode preencher os dados manualmente.');
          if (!response.ok) throw new HttpError(502, 'BrasilAPI indisponível. Tente novamente ou preencha manualmente.');
          return normalizeCompany(await response.json(), cnpj);
        })()]);
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(cnpj, { value, expires: now() + ttlMs });
        return { ...value, cached: false };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(controller.signal.aborted ? 504 : 502, 'Não foi possível consultar a BrasilAPI. Tente novamente ou preencha manualmente.');
      } finally { clearTimeout(timer); }
    })();
    pending.set(cnpj, task);
    try { return await task; } finally { pending.delete(cnpj); }
  } };
}
