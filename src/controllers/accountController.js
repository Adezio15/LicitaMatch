import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE, SESSION_LIFETIME_MS, REMEMBER_LIFETIME_MS, cookieOptions } from '../config/session.js';
import { validate, registerSchema, loginSchema, companySchema, userCreateSchema, userUpdateSchema, changePasswordSchema, validId, states } from '../utils/validation.js';
import { HttpError } from '../utils/httpError.js';

const isApi = req => req.path.startsWith('/api/');
const safeUser = user => ({ id: user.id, empresa_id: user.empresa_id, nome: user.nome, email: user.email, tipo: user.tipo, ativo: user.ativo });
const sessionOperation = (req, method) => new Promise((resolve, reject) => req.session[method](error => error ? reject(error) : resolve()));

export function accountController(service, config) {
  async function startSession(req, user, remember) {
    await sessionOperation(req, 'regenerate');
    req.session.userId = String(user.id);
    req.session.empresaId = String(user.empresa_id);
    req.session.authVersion = user.auth_version;
    req.session.expiresAt = Date.now() + (remember ? REMEMBER_LIFETIME_MS : SESSION_LIFETIME_MS);
    req.session.csrfToken = randomBytes(32).toString('hex');
    req.session.cookie.maxAge = remember ? REMEMBER_LIFETIME_MS : null;
    await sessionOperation(req, 'save');
  }
  return {
    loginPage(req, res) {
      if (req.user) return res.redirect('/conta');
      res.render('auth/login', { title: 'Entrar', changed: req.query.senha === 'alterada' });
    },
    registerPage(req, res) {
      if (req.user) return res.redirect('/conta');
      res.render('auth/register', { title: 'Criar conta', states });
    },
    async register(req, res) {
      const data = validate(registerSchema, req.body);
      const { user, company } = await service.register(data);
      await startSession(req, user, false);
      if (isApi(req)) return res.status(201).json({ user: safeUser(user), company, csrfToken: req.session.csrfToken });
      res.redirect(303, '/conta');
    },
    async login(req, res) {
      let data;
      try { data = validate(loginSchema, req.body); }
      catch { throw new HttpError(401, 'E-mail ou senha inválidos'); }
      const user = await service.login(data);
      await startSession(req, user, data.lembrar);
      if (isApi(req)) return res.json({ user: safeUser(user), csrfToken: req.session.csrfToken });
      res.redirect(303, '/conta');
    },
    async logout(req, res) {
      await sessionOperation(req, 'destroy');
      res.clearCookie(SESSION_COOKIE, cookieOptions(config));
      if (isApi(req)) return res.status(204).end();
      res.redirect(303, '/login');
    },
    me(req, res) { res.json({ user: safeUser(req.user) }); },
    accountPage(req, res) { res.render('account/home', { title: 'Minha conta' }); },
    async company(req, res) {
      const company = await service.repository.getCompany(req.user.empresa_id);
      if (isApi(req)) return res.json({ company });
      res.render('account/company', { title: 'Empresa', company, states, saved: req.query.salvo === '1' });
    },
    async updateCompany(req, res) {
      const company = await service.repository.updateCompany(req.user.empresa_id, validate(companySchema, req.body));
      if (isApi(req)) return res.json({ company });
      res.redirect(303, '/empresa?salvo=1');
    },
    async users(req, res) {
      const users = await service.repository.listUsers(req.user.empresa_id);
      if (isApi(req)) return res.json({ users });
      res.render('account/users', { title: 'Usuários', users, saved: req.query.salvo === '1' });
    },
    async user(req, res) {
      const user = await service.repository.getUser(req.user.empresa_id, validId(req.params.id));
      if (!user) throw new HttpError(404, 'Usuário não encontrado');
      if (isApi(req)) return res.json({ user });
      res.render('account/user', { title: 'Editar usuário', target: user });
    },
    async createUser(req, res) {
      const user = await service.createUser(req.user.empresa_id, validate(userCreateSchema, req.body));
      if (isApi(req)) return res.status(201).json({ user: safeUser(user) });
      res.redirect(303, '/usuarios?salvo=1');
    },
    async updateUser(req, res) {
      const user = await service.updateUser(req.user, validId(req.params.id), validate(userUpdateSchema, req.body));
      if (isApi(req)) return res.json({ user: safeUser(user) });
      res.redirect(303, '/usuarios?salvo=1');
    },
    async changePassword(req, res) {
      await service.changePassword(req.user, validate(changePasswordSchema, req.body));
      await sessionOperation(req, 'destroy');
      res.clearCookie(SESSION_COOKIE, cookieOptions(config));
      if (isApi(req)) return res.status(204).end();
      res.redirect(303, '/login?senha=alterada');
    }
  };
}
