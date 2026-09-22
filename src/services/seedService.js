import bcrypt from 'bcrypt';
import { validate, registerSchema } from '../utils/validation.js';

const validRoles = new Set(['gestor', 'admin']);

export async function seedDevelopment(database, env) {
  if (env.NODE_ENV !== 'development') throw new Error('Seed permitido somente com NODE_ENV=development explícito.');
  const role = env.SEED_USER_ROLE || 'gestor';
  if (!validRoles.has(role)) throw new Error('SEED_USER_ROLE deve ser "gestor" ou "admin".');

  const data = validate(registerSchema, {
    razao_social: 'Empresa Exemplo LTDA', nome_fantasia: 'Empresa Exemplo',
    cnpj: '11222333000181', email_empresa: 'empresa@example.test',
    telefone: '', cidade: 'Mossoró', estado: 'RN',
    nome: role === 'admin' ? 'Administrador Local' : 'Gestor Exemplo',
    email: env.SEED_USER_EMAIL || (role === 'admin' ? 'admin@local.test' : 'gestor@example.test'),
    senha: env.SEED_USER_PASSWORD
  });

  const { rows } = await database.query('SELECT id FROM empresas WHERE cnpj=$1', [data.cnpj]);
  if (rows.length) return false;

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query(`INSERT INTO empresas
      (razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [data.razao_social, data.nome_fantasia, data.cnpj, data.email_empresa, data.telefone, data.cidade, data.estado || null]);
    const hash = await bcrypt.hash(data.senha, 12);
    await client.query(`INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo)
      VALUES ($1,$2,$3,$4,$5)`,
    [company.rows[0].id, data.nome, data.email, hash, role]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
