export { createWhatsAppService } from './twilioWhatsAppService.js';
export function normalizeWhatsAppNumber(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]*$/.test(value) || value.length>30) throw new Error('Informe um celular válido com DDD.');
  const digits = value.replace(/\D/g,'');
  if (!digits) return '';
  const number = digits.length===11 ? '+55'+digits : '+'+digits;
  if (!/^\+55[1-9]\d9\d{8}$/.test(number)) throw new Error('Informe um celular brasileiro com DDD e nove dígitos.');
  return number;
}

// Validate the provider address separately from user-entered phone formatting.
// Called only after signature validation; never decode or repair this value.
export function normalizeWhatsAppSender(value) {
  const invalid = code => { throw Object.assign(new Error('Remetente WhatsApp brasileiro inválido.'), {code}); };
  if (Array.isArray(value)) return invalid('from_duplicated');
  if (typeof value !== 'string') return invalid('from_not_string');
  if (!value.startsWith('whatsapp:+')) return invalid('from_prefix_invalid');
  const address = value.slice('whatsapp:'.length);
  if (!/^\+\d+$/.test(address)) return invalid('from_characters_invalid');
  if (!address.startsWith('+55')) return invalid('from_country_invalid');
  if (address.length !== 14) return invalid('from_length_invalid');
  if (!/^\+55[1-9]\d9\d{8}$/.test(address)) return invalid('from_mobile_format_invalid');
  return normalizeWhatsAppNumber(address);
}
