import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { accountService } from '../services/accountService.js';
import { accountController } from '../controllers/accountController.js';
import { loadUser, requireAuth, requireManager, requireAdmin } from '../middlewares/auth.js';
import { csrf } from '../middlewares/csrf.js';
import { opportunityRoutes } from './opportunityRoutes.js';

export function accountRoutes(database, config) {
  const router = Router();
  const service = accountService(database);
  const controller = accountController(service, config);
  const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } });
  const signupLimit = rateLimit({ windowMs: 60 * 60000, limit: 5,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Limite de cadastros atingido. Tente mais tarde.' } });

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(loadUser(service.repository, config), csrf);
  router.use(opportunityRoutes(database));
  router.get('/', (req, res) => res.redirect(req.user ? '/conta' : '/login'));
  router.get('/login', controller.loginPage);
  router.get('/cadastro', controller.registerPage);
  router.get('/api/auth/csrf', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  router.post(['/login', '/api/auth/login'], loginLimit, controller.login);
  router.post(['/cadastro', '/api/auth/register'], signupLimit, controller.register);
  router.post(['/logout', '/api/auth/logout'], requireAuth, controller.logout);
  router.get('/api/auth/me', requireAuth, controller.me);
  router.get('/admin', requireAuth, requireAdmin, controller.adminDashboard);
  router.get('/admin/operacao', requireAuth, requireAdmin, async (req,res) => {
    res.render('account/operations', { title: 'Operação', data: await req.app.locals.operations.overview(), scheduled: req.query.agendado === '1' });
  });
  router.post('/admin/operacao/sincronizar', requireAuth, requireAdmin, async (req,res) => {
    await req.app.locals.operations.schedule();
    res.redirect(303,'/admin/operacao?agendado=1');
  });
  router.get('/api/admin/empresas', requireAuth, requireAdmin, controller.adminEmpresas);
  router.get('/conta', requireAuth, controller.accountPage);
  router.post(['/conta/senha', '/api/auth/password'], requireAuth, loginLimit, controller.changePassword);
  router.get(['/empresa', '/api/empresa'], requireAuth, controller.company);
  router.post('/empresa', requireAuth, requireManager, controller.updateCompany);
  router.patch('/api/empresa', requireAuth, requireManager, controller.updateCompany);
  router.get(['/usuarios', '/api/usuarios'], requireAuth, requireManager, controller.users);
  router.get(['/usuarios/:id', '/api/usuarios/:id'], requireAuth, requireManager, controller.user);
  router.post(['/usuarios', '/api/usuarios'], requireAuth, requireManager, controller.createUser);
  router.post('/usuarios/:id', requireAuth, requireManager, controller.updateUser);
  router.patch('/api/usuarios/:id', requireAuth, requireManager, controller.updateUser);
  return router;
}
