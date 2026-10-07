import { premiumTrialService } from '../services/premiumTrialService.js';
import { validId } from '../utils/validation.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { accountService } from '../services/accountService.js';
import { accountController } from '../controllers/accountController.js';
import { loadUser, requireAuth, requireManager, requireAdmin } from '../middlewares/auth.js';
import { csrf } from '../middlewares/csrf.js';
import { opportunityRoutes } from './opportunityRoutes.js';

export function accountRoutes(database, config, logger) {
  const router = Router();
  const service = accountService(database);
  const controller = accountController(service, config);
  const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } });
  const signupLimit = rateLimit({ windowMs: 60 * 60000, limit: 5,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Limite de cadastros atingido. Tente mais tarde.' } });

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(loadUser(service.repository, config), csrf);
  const trials = premiumTrialService(database, config, logger);
  router.post(['/conta/teste-premium','/api/testes-premium'], requireAuth, async (req,res) => {
    const result = await trials.request(req.user,{ip:req.ip,userAgent:(req.get('user-agent') || '').slice(0,2000)});
    if (req.path.startsWith('/api/')) return res.status(201).json(result);
    res.redirect(303,'/conta?teste=solicitado');
  });
  router.post(['/conta/contratar','/api/planos/contratar'],requireAuth,requireManager,async (req,res)=>{
    const result = await trials.contract(req.user,req.body.plano);
    if (req.path.startsWith('/api/')) return res.status(202).json(result);
    res.render('account/message',{title:'Contratação',message:result.message});
  });
  router.get(['/admin/testes-premium','/api/admin/testes-premium'],requireAuth,requireAdmin,async(req,res)=>{
    const trialsList = await trials.list();
    if(req.path.startsWith('/api/')) return res.json({trials:trialsList});
    res.render('account/trials',{title:'Testes Premium',trials:trialsList});
  });
  router.get('/api/admin/testes-premium/:id',requireAuth,requireAdmin,async(req,res)=>{
    const trial = (await trials.list(validId(req.params.id)))[0];
    if (!trial) return res.status(404).json({error:'Solicitação não encontrada'});
    res.json({trial});
  });
  router.post(['/admin/testes-premium/:id/:action','/api/admin/testes-premium/:id/:action'],requireAuth,requireAdmin,async(req,res)=>{
    if (!['aprovar','recusar'].includes(req.params.action)) return res.status(422).json({error:'Ação inválida'});
    await trials.decide(validId(req.params.id),req.user,req.params.action==='aprovar');
    if(req.path.startsWith('/api/')) return res.json({ok:true});
    res.redirect(303,'/admin/testes-premium');
  });
  router.get('/conta/seguranca',requireAuth,(req,res)=>res.render('account/security',{title:'Segurança'}));
  router.use(opportunityRoutes(database));
  router.get('/', (req, res) => res.redirect(req.user ? (req.user.tipo === 'admin' ? '/admin' : '/conta') : '/login'));
  router.get('/login', controller.loginPage);
  router.get('/cadastro', controller.registerPage);
  router.get('/api/auth/csrf', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  router.post(['/login', '/api/auth/login'], loginLimit, controller.login);
  router.post(['/cadastro', '/api/auth/register'], signupLimit, controller.register);
  router.post(['/logout', '/api/auth/logout'], requireAuth, controller.logout);
  router.get('/api/auth/me', requireAuth, controller.me);
  router.get('/admin', requireAuth, requireAdmin, controller.adminDashboard);
  router.get('/admin/operacao', requireAuth, requireAdmin, async (req,res) => {
    res.render('account/operations', { title: 'Operação', data: await req.app.locals.operations.overview(), scheduled: req.query.agendado === '1', emailTest: req.query.emailTeste });
  });
  // Temporary email diagnostic; restricted to administrators and protected by CSRF.
  router.post('/admin/operacao/email-teste', requireAuth, requireAdmin,
    rateLimit({ windowMs: 60000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req,res) => {
      const to = typeof req.body.email === 'string' ? req.body.email.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) return res.status(422).json({ error: 'Informe um e-mail válido.' });
      try {
        await req.app.locals.operations.sendTestEmail(to, req.id);
        res.redirect(303, '/admin/operacao?emailTeste=enviado');
      } catch {
        res.redirect(303, '/admin/operacao?emailTeste=falhou');
      }
    });
  router.post('/admin/operacao/sincronizar', requireAuth, requireAdmin, async (req,res) => {
    await req.app.locals.operations.schedule();
    res.redirect(303,'/admin/operacao?agendado=1');
  });
  const changePlan = async (req, res) => {
    const company = await service.changePlan(validId(req.params.id), req.body.plano);
    if (req.path.startsWith('/api/')) return res.json({ company });
    res.redirect(303, '/admin');
  };
  router.post('/admin/empresas/:id/plano', requireAuth, requireAdmin, changePlan);
  router.patch('/api/admin/empresas/:id/plano', requireAuth, requireAdmin, changePlan);
  router.post('/admin/empresas/:id/excluir', requireAuth, requireAdmin, async (req, res) => {
    await service.deleteCompany(req.user, validId(req.params.id));
    res.redirect(303, '/admin');
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
