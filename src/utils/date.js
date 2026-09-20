export const APP_TIMEZONE = 'America/Fortaleza';

export function formatDateTime(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError('A data deve informar UTC ou offset explícito.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Data inválida');
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIMEZONE, dateStyle: 'short', timeStyle: 'short'
  }).format(date);
}
