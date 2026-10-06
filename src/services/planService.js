import { HttpError } from '../utils/httpError.js';

export const plans = Object.freeze({
  start: { name: 'Start', users: 1, features: [] },
  pro: { name: 'Pro', users: 3, features: ['match', 'email'] },
  premium: { name: 'Premium', users: 10, features: ['match', 'email', 'reports', 'whatsapp'] }
});
export function assertFeature(plan, feature) {
  if (!plans[plan]?.features.includes(feature)) {
    const labels = { match: 'Match de compatibilidade', email: 'Alertas por e-mail', reports: 'Relatórios', whatsapp: 'Alertas pelo WhatsApp' };
    throw new HttpError(403, `${labels[feature]} exige upgrade para o plano ${['reports','whatsapp'].includes(feature) ? 'Premium' : 'Pro ou Premium'}.`);
  }
}
export async function companyPlan(database, empresaId) {
  const { rows } = await database.query('SELECT plano FROM empresas WHERE id=$1', [empresaId]);
  if (!rows[0]) throw new HttpError(404, 'Empresa não encontrada');
  return rows[0].plano;
}
export const requireFeature = feature => (req, _res, next) => { assertFeature(req.user.plano, feature); next(); };
export async function assertUserCapacity(database, empresaId) {
  const plan = await companyPlan(database, empresaId);
  const { rows } = await database.query('SELECT count(*)::int AS total FROM usuarios WHERE empresa_id=$1 AND ativo=true', [empresaId]);
  if (!plans[plan] || rows[0].total >= plans[plan].users) throw new HttpError(403,
    `O plano ${plans[plan]?.name || plan} permite até ${plans[plan]?.users || 0} usuário(s) ativo(s). Desative um acesso ou faça upgrade do plano.`);
}
