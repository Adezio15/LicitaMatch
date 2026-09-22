import { emailSchema, passwordSchema } from '../utils/validation.js';
import { hashPassword } from '../utils/password.js';

// Only these controlled messages may reach the CLI. Database errors may contain secrets.
export class AdminSeedError extends Error {}

export function parseAdminSeed(env, args = []) {
  if (args.some(arg => arg !== '--update-password') || args.length > 1) {
    throw new AdminSeedError('Uso: npm run admin:create [-- --update-password]');
  }
  if (env.SEED_USER_ROLE !== 'admin') throw new AdminSeedError('Defina SEED_USER_ROLE=admin.');
  const email = emailSchema.safeParse(env.SEED_USER_EMAIL);
  if (!email.success) throw new AdminSeedError('Defina SEED_USER_EMAIL com um e-mail válido.');
  if (!passwordSchema.safeParse(env.SEED_USER_PASSWORD).success) {
    throw new AdminSeedError('SEED_USER_PASSWORD deve ter pelo menos 12 caracteres e no máximo 72 bytes UTF-8.');
  }
  const companyId = env.SEED_COMPANY_ID || undefined;
  if (companyId && !/^[1-9]\d{0,17}$/.test(companyId)) throw new AdminSeedError('SEED_COMPANY_ID inválido.');
  return { email: email.data, password: env.SEED_USER_PASSWORD, companyId, updatePassword: args.includes('--update-password') };
}

// Receives a dedicated connection; all writes are atomic and parameterized.
export async function createAdmin(client, options) {
  const { email, password, companyId, updatePassword } = options;
  await client.query('BEGIN');
  try {
    // Serialize this command for the same normalized email, including concurrent first creation.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
    const { rows: [existing] } = await client.query(
      'SELECT id, empresa_id, tipo, ativo FROM usuarios WHERE lower(trim(email))=$1 FOR UPDATE', [email]);
    if (existing && existing.tipo !== 'admin') throw new AdminSeedError('E-mail pertence a um usuário não administrador; nenhuma alteração realizada.');
    if (existing && companyId && String(existing.empresa_id) !== companyId) throw new AdminSeedError('Administrador pertence a outra empresa; nenhuma alteração realizada.');
    if (!existing && updatePassword) throw new AdminSeedError('Administrador não encontrado para atualização.');
    if (!existing && !companyId) throw new AdminSeedError('Defina SEED_COMPANY_ID com o ID de uma empresa existente para criar o administrador. Cadastre a empresa primeiro se o banco estiver vazio.');
    const { rows: [company] } = await client.query('SELECT status FROM empresas WHERE id=$1 FOR SHARE', [existing?.empresa_id || companyId]);
    if (!company || company.status !== 'ativo' || existing?.ativo === false) throw new AdminSeedError('A empresa e o administrador devem estar ativos; nenhum status foi alterado.');
    let status = 'exists';
    if (!existing) {
      await client.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, tipo)
        VALUES ($1, $2, $3, $4, 'admin')`, [companyId, 'Administrador', email, await hashPassword(password)]);
      status = 'created';
    } else if (updatePassword) {
      await client.query('UPDATE usuarios SET senha_hash=$2, auth_version=auth_version+1 WHERE id=$1',
        [existing.id, await hashPassword(password)]);
      status = 'updated';
    }
    await client.query('COMMIT');
    return status;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
