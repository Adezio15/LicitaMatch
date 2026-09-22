import { HttpError } from '../utils/httpError.js';
import { SESSION_COOKIE, cookieOptions } from '../config/session.js';

export function loadUser(repository, config) {
  return async (req, res, next) => {
    res.locals.user = null;
    if (!req.session.userId) return next();
    const user = await repository.findSessionUser(req.session.userId, req.session.empresaId);
    if (!user || !user.ativo || user.empresa_status !== 'ativo' || user.auth_version !== req.session.authVersion || !(req.session.expiresAt > Date.now())) {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      res.clearCookie(SESSION_COOKIE, cookieOptions(config));
      if (req.path.startsWith('/api/')) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      return res.redirect(303, '/login');
    }
    req.user = user;
    res.locals.user = user;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) throw new HttpError(401, 'Entre para continuar');
  return res.redirect(303, '/login');
}

export function requireManager(req, _res, next) {
  if (!['gestor', 'admin'].includes(req.user?.tipo)) throw new HttpError(403, 'Acesso permitido somente a gestores');
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.tipo !== 'admin') throw new HttpError(403, 'Acesso reservado ao administrador');
  next();
}
