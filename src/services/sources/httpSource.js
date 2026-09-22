export function queryWindow(query = {}) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 10 || pageSize > 500) throw new Error('Paginação inválida.');
  const today = new Date().toISOString().slice(0,10);
  const start = query.dataInicial || today, end = query.dataFinal || today;
  for (const value of [start,end]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Data de consulta inválida.');
  if (start > end) throw new Error('Período de consulta inválido.');
  return { page,pageSize,start,end };
}

export async function fetchJson(fetchImpl, url, name) {
  const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response || typeof response.ok !== 'boolean') throw new Error(`Resposta inválida de ${name}.`);
  if (!response.ok) throw new Error(`${name} API falhou (${response.status || 500}).`);
  if (response.status === 204) return { data: [], resultado: [], totalPaginas: 0 };
  const payload = typeof response.json === 'function' ? await response.json() : JSON.parse(await response.text());
  if (!payload || typeof payload !== 'object') throw new Error(`Resposta inválida de ${name}.`);
  return payload;
}

export function unitName(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.nome || value?.nomeUnidade || value?.razaoSocial || value?.unidadeGestora || value?.orgao || '').trim();
}
