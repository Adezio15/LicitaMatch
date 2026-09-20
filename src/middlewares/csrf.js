import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    req.session.csrfToken ||= randomBytes(32).toString('hex');
  } else {
    const token = req.get('X-CSRF-Token') || req.body?._csrf;
    const expected = req.session.csrfToken;
    if (typeof token !== 'string' || typeof expected !== 'string' || token.length !== 64 || !/^[a-f0-9]{64}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new HttpError(403, 'Formulário expirado ou inválido. Recarregue a página e tente novamente.');
    }
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}
