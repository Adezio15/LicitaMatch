import { Router } from 'express';
import { requireAuth, requireManager } from '../middlewares/auth.js';
import { opportunityService, interestSchema, statusSchema, filterSchema, alertPreferenceSchema, whatsappPreferenceSchema } from '../services/opportunityService.js';
import { validate, validId } from '../utils/validation.js';

export function opportunityRoutes(database) {
  const router = Router();
  const service = opportunityService(database);
  router.post(['/conta/whatsapp','/api/conta/whatsapp'],requireAuth,requireManager,async (req,res)=>{
    const data = validate(whatsappPreferenceSchema,req.body);
    await database.query(`UPDATE usuarios SET whatsapp_numero=$3,alertas_whatsapp=$4,
      whatsapp_consentimento_em=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1 AND empresa_id=$2`,
    [req.user.id,req.user.empresa_id,data.whatsapp_numero,data.alertas_whatsapp]);
    if (req.path.startsWith('/api/')) return res.json({whatsapp_numero:data.whatsapp_numero,alertas_whatsapp:data.alertas_whatsapp});
    res.redirect(303,'/conta?alertas=salvos#whatsapp');
  });
  router.post(['/conta/alertas','/api/conta/alertas'],requireAuth,async (req,res) => {
    const data = validate(alertPreferenceSchema,req.body);
    await database.query('UPDATE usuarios SET alertas_email=$3 WHERE id=$1 AND empresa_id=$2', [req.user.id,req.user.empresa_id,data.alertas_email]);
    if (req.path.startsWith('/api/')) return res.json(data);
    res.redirect(303,'/conta?alertas=salvos#alertas');
  });
  router.get(['/interesses','/api/interesses'], requireAuth, async (req,res) => {
    const interests = await service.interests(req.user.empresa_id);
    if (req.path.startsWith('/api/')) return res.json({ interests });
    res.render('account/interests', { title: 'Interesses', interests, saved: req.query.salvo === '1' });
  });
  const save = async (req,res) => {
    const interest = await service.saveInterest(req.user.empresa_id,validate(interestSchema,req.body),req.params.id ? validId(req.params.id) : null);
    if (req.path.startsWith('/api/')) return res.status(req.params.id ? 200 : 201).json({ interest });
    res.redirect(303,'/interesses?salvo=1');
  };
  router.post(['/interesses','/api/interesses'], requireAuth, requireManager, save);
  router.post('/interesses/:id', requireAuth, requireManager, save);
  router.patch('/api/interesses/:id', requireAuth, requireManager, save);
  router.get(['/oportunidades','/api/oportunidades'], requireAuth, async (req,res) => {
    const data = await service.list(req.user.empresa_id,validate(filterSchema,req.query));
    if (req.path.startsWith('/api/')) return res.json(data);
    res.render('account/opportunities', { title: 'Oportunidades', ...data });
  });
  const update = async (req,res) => {
    const match = await service.updateStatus(req.user.empresa_id,validId(req.params.id),validate(statusSchema,req.body).status);
    if (req.path.startsWith('/api/')) return res.json({ match });
    res.redirect(303,'/oportunidades');
  };
  router.post('/oportunidades/:id',requireAuth,requireManager,update);
  router.patch('/api/oportunidades/:id',requireAuth,requireManager,update);
  return router;
}
