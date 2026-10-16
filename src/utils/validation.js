import { z } from 'zod';
import { HttpError } from './httpError.js';

export const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const text = (label, max = 150) => z.string().trim().min(1, `${label} é obrigatório`).max(max);
export const emailSchema = z.string().trim().toLowerCase().email('Informe um e-mail válido').max(254);
export const passwordSchema = z.string().min(12, 'A senha deve ter pelo menos 12 caracteres')
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes');

export function validCnpj(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9]{12}\d{2}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (base, weights) => {
    const rest = [...base].reduce((sum, char, i) => sum + (char.charCodeAt(0) - 48) * weights[i], 0) % 11;
    return rest < 2 ? '0' : String(11 - rest);
  };
  const base = value.slice(0, 12);
  const first = digit(base, [5,4,3,2,9,8,7,6,5,4,3,2]);
  return value.slice(12) === first + digit(base + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

export const normalizeCnpj = value => value.trim().toUpperCase().replace(/[.\/-]/g, '');
export const cnpjSchema = z.string().trim().max(18).regex(/^(?:[A-Za-z0-9]{12}\d{2}|[A-Za-z0-9]{2}\.[A-Za-z0-9]{3}\.[A-Za-z0-9]{3}\/[A-Za-z0-9]{4}-\d{2})$/, 'CNPJ inválido').transform(normalizeCnpj).refine(validCnpj, 'CNPJ inválido');
export const companyRegistryFields = {
  situacao_cadastral: z.string().trim().max(100).optional(),
  logradouro: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(30).optional(),
  complemento: z.string().trim().max(200).optional(),
  bairro: z.string().trim().max(100).optional(),
  cep: z.string().trim().transform(v => v.replace('-', '')).refine(v => !v || /^\d{8}$/.test(v), 'CEP inválido').optional()
};

const companyFields = {
  ...companyRegistryFields,
  razao_social: text('Razão social', 200),
  nome_fantasia: z.string().trim().max(200).default(''),
  email_empresa: emailSchema,
  telefone: z.string().trim().max(30).default(''),
  cidade: z.string().trim().max(100).default(''),
  estado: z.enum(states).or(z.literal('')).default('')
};

export const registerSchema = z.object({
  ...companyFields,
  cnpj: cnpjSchema,
  cnae_principal: z.string().regex(/^\d{7}$/).or(z.literal('')).default(''),
  cnae_descricao: z.string().trim().max(1000).default(''),
  nome: text('Nome'), email: emailSchema, senha: passwordSchema
}).strict().refine(data => Boolean(data.cnae_principal) === Boolean(data.cnae_descricao), 'Informe o código e a descrição do CNAE principal');
export const companySchema = z.object(companyFields).strict();
export const loginSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
  lembrar: z.union([z.boolean(), z.literal('on')]).optional().transform(value => value === true || value === 'on')
}).strict();
export const userCreateSchema = z.object({
  nome: text('Nome'), email: emailSchema, senha: passwordSchema,
  tipo: z.enum(['usuario', 'gestor']).default('usuario')
}).strict();
export const userUpdateSchema = z.object({
  nome: text('Nome'), email: emailSchema,
  tipo: z.enum(['usuario', 'gestor']),
  ativo: z.union([z.boolean(), z.enum(['true', 'false'])]).transform(value => value === true || value === 'true')
}).strict();
export const changePasswordSchema = z.object({ senha_atual: z.string().min(1).max(72), senha: passwordSchema }).strict();

export function validate(schema, input) {
  // CSRF pertence ao transporte e não ao modelo de domínio.
  const { _csrf, ...data } = input || {};
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(422, result.error.issues.map(issue => issue.message).join('. '));
  return result.data;
}

export function validId(value) {
  if (!/^[1-9]\d{0,17}$/.test(String(value))) throw new HttpError(404, 'Usuário não encontrado');
  return String(value);
}
