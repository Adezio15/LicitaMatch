import { cnpjSchema, states } from '../utils/validation.js';
import { HttpError } from '../utils/httpError.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function normalizeCompany(data, cnpj) {
  const site = data?.estabelecimento;
  if (!site || cnpjSchema.safeParse(site.cnpj).data !== cnpj || !clean(data.razao_social)) throw new HttpError(502, 'Resposta inválida do CNPJ.ws. Tente novamente.');
  const code = String(site.atividade_principal?.id ?? '').padStart(7, '0');
  const situations = { '01': 'NULA', '02': 'ATIVA', '03': 'SUSPENSA', '04': 'INAPTA', '08': 'BAIXADA' };
  return {
    cnpj, razao_social: clean(data.razao_social), nome_fantasia: clean(site.nome_fantasia),
    situacao_cadastral: situations[String(site.situacao_cadastral).padStart(2, '0')] || '',
    logradouro: clean([site.tipo_logradouro, site.logradouro].filter(Boolean).join(' ')),
    numero: clean(site.numero, 30), complemento: clean(site.complemento), bairro: clean(site.bairro, 100),
    cep: /^\d{8}$/.test(String(site.cep ?? '').replace(/\D/g, '')) ? String(site.cep).replace(/\D/g, '') : '',
    cidade: clean(site.cidade?.nome, 100), estado: states.includes(site.estado?.sigla) ? site.estado.sigla : '',
    telefone: site.telefone1 ? clean(`${site.ddd1 || ''}${site.telefone1}`, 30) : '',
    email_empresa: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email || '') ? clean(site.email, 254).toLowerCase() : '',
    cnae_principal: /^\d{7}$/.test(code) && Number(code) > 0 ? code : '', cnae_descricao: clean(site.atividade_principal?.descricao, 1000)
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
          const response = await fetchImpl(`https://publica.cnpj.ws/cnpj/${cnpj}`, { signal: controller.signal, headers: { Accept: 'application/json' }, redirect: 'error' });
          if (response.status === 404) throw new HttpError(404, 'CNPJ não encontrado no CNPJ.ws. Você pode preencher os dados manualmente.');
          if (response.status === 429) throw new HttpError(429, 'Limite do CNPJ.ws atingido. Tente novamente mais tarde.');
          if (response.status === 400) throw new HttpError(422, 'O CNPJ.ws não aceitou este CNPJ. Você pode preencher os dados manualmente.');
          if (!response.ok) throw new HttpError(502, 'CNPJ.ws indisponível. Tente novamente ou preencha manualmente.');
          return normalizeCompany(await response.json(), cnpj);
        })()]);
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(cnpj, { value, expires: now() + ttlMs });
        return { ...value, cached: false };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(controller.signal.aborted ? 504 : 502, 'Não foi possível consultar o CNPJ.ws. Tente novamente ou preencha manualmente.');
      } finally { clearTimeout(timer); }
    })();
    pending.set(cnpj, task);
    try { return await task; } finally { pending.delete(cnpj); }
  } };
}
