import { accountService } from './accountService.js';
import { validate, registerSchema } from '../utils/validation.js';

export async function seedDevelopment(database, env) {
  if (env.NODE_ENV !== 'development') throw new Error('Seed permitido somente com NODE_ENV=development explícito.');
  const data = validate(registerSchema, {
    razao_social: 'Empresa Exemplo LTDA', nome_fantasia: 'Empresa Exemplo',
    cnpj: '11222333000181', email_empresa: 'empresa@example.test',
    telefone: '', cidade: 'Mossoró', estado: 'RN',
    nome: 'Gestor Exemplo', email: env.SEED_USER_EMAIL || 'gestor@example.test', senha: env.SEED_USER_PASSWORD
  });
  const { rows } = await database.query('SELECT id FROM empresas WHERE cnpj=$1', [data.cnpj]);
  if (rows.length) return false;
  await accountService(database).register(data);
  return true;
}
