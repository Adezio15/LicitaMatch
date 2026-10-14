export { createWhatsAppService } from './twilioWhatsAppService.js';
export function normalizeWhatsAppNumber(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]*$/.test(value) || value.length>30) throw new Error('Informe um celular válido com DDD.');
  const digits = value.replace(/\D/g,'');
  if (!digits) return '';
  const number = digits.length===11 ? '+55'+digits : '+'+digits;
  if (!/^\+55[1-9]\d9\d{8}$/.test(number)) throw new Error('Informe um celular brasileiro com DDD e nove dígitos.');
  return number;
}
