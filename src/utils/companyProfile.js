import { z } from 'zod';
import { states, companySchema, validCnpj } from './validation.js';

const optionalText = (max = 200) => z.string().trim().max(max).default('');
const requiredText = (max = 200) => z.string().trim().min(1, 'Preencha os campos obrigatórios de cada registro').max(max);
const numeric = (max, integer = false, decimals = 2) => z.preprocess(value => {
  if (value === '' || value == null) return null;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return value;
}, (integer ? z.number().int() : z.number().multipleOf(10 ** -decimals, `Use no máximo ${decimals} casas decimais`)).finite().min(0).max(max).nullable());
const positive = numeric(999999999999, false, 3).refine(value => value === null || value > 0, 'A quantidade deve ser positiva');
const tags = z.array(requiredText(100)).max(50).default([]).transform(items => [...new Set(items)]);
const list = schema => z.array(schema.strict()).max(100);
const cnpj = z.string().trim().regex(/^[\d./-]+$/, 'CNPJ inválido').transform(value => value.replace(/\D/g, '')).refine(validCnpj, 'CNPJ inválido');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').refine(value => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10) === value;
}, 'Data inválida').or(z.literal('')).default('');

export const profileSchemas = {
  empresa: companySchema.extend({ cnpj }).strict(),
  atividades: z.object({ atividades: list(z.object({
    tipo: z.enum(['principal','secundario','efetiva']),
    cnae: optionalText(10).transform(value => value.replace(/[.\/-]/g, '')).refine(value => !value || /^\d{7}$/.test(value), 'CNAE deve conter 7 dígitos'),
    descricao: requiredText(1000)
  }).refine(row => row.tipo === 'efetiva' || row.cnae, 'Informe o código do CNAE')) }).strict().superRefine((data, ctx) => {
    const registered = data.atividades.filter(row => row.tipo !== 'efetiva');
    if (registered.filter(row => row.tipo === 'principal').length > 1) ctx.addIssue({ code: 'custom', message: 'Informe apenas um CNAE principal' });
    if (new Set(registered.map(row => row.cnae)).size !== registered.length) ctx.addIssue({ code: 'custom', message: 'CNAE cadastrado em duplicidade' });
  }),
  catalogo: z.object({
    produtos: list(z.object({ tipo: z.enum(['produto','servico']), nome: requiredText(), descricao: optionalText(2000), categoria: optionalText(), palavras_chave: tags, especificacoes: optionalText(4000), unidade: optionalText(80), capacidade: optionalText(1000) })),
    marcas: list(z.object({ marca: optionalText(), fabricante: optionalText(), marcas_equivalentes: tags, produtos_equivalentes: optionalText(2000) }).refine(row => row.marca || row.fabricante || row.marcas_equivalentes.length || row.produtos_equivalentes, 'Preencha a marca, fabricante ou equivalência'))
  }).strict(),
  atendimento: z.object({
    atendimento_nacional: z.boolean(),
    regioes: list(z.object({ tipo: z.enum(['estado','regiao','municipio']), estado: z.enum(states).or(z.literal('')).default(''), nome: optionalText(150) }).superRefine((row,ctx) => {
      if ((row.tipo === 'estado' && !row.estado) || (row.tipo === 'municipio' && (!row.estado || !row.nome)) || (row.tipo === 'regiao' && (row.estado || !['Norte','Nordeste','Centro-Oeste','Sudeste','Sul'].includes(row.nome)))) ctx.addIssue({ code: 'custom', message: 'Informe uma região válida; municípios exigem nome e UF' });
    }))
  }).strict().refine(data => !data.atendimento_nacional || !data.regioes.length, 'Selecione atendimento nacional ou regiões específicas'),
  comercial: z.object({
    capacidade_quantidade: positive, capacidade_unidade: optionalText(80), capacidade_periodo: z.enum(['','dia','mes','pedido','outro']), capacidade_descricao: optionalText(2000),
    oportunidade_min: numeric(999999999999), oportunidade_max: numeric(999999999999), margem_min: numeric(100),
    entrega_quantidade: numeric(36500,true).refine(value => value === null || value > 0, 'Prazo deve ser positivo'), entrega_unidade: z.enum(['','dias_uteis','dias_corridos'])
  }).strict().superRefine((row,ctx) => {
    if (row.oportunidade_min !== null && row.oportunidade_max !== null && row.oportunidade_max < row.oportunidade_min) ctx.addIssue({ code: 'custom', message: 'O valor máximo deve ser maior ou igual ao mínimo' });
    if ((row.entrega_quantidade === null) !== (row.entrega_unidade === '')) ctx.addIssue({ code: 'custom', message: 'Informe a quantidade e a unidade do prazo' });
    if (row.capacidade_quantidade !== null && (!row.capacidade_unidade || !row.capacidade_periodo)) ctx.addIssue({ code: 'custom', message: 'Informe unidade e período da capacidade' });
  }),
  documentacao: z.object({
    documentos: list(z.object({ tipo: requiredText(), observacao: optionalText(1000) })),
    certificacoes: list(z.object({ nome: requiredText(), numero: optionalText(), orgao_emissor: optionalText(), validade: date, observacao: optionalText(1000) }))
  }).strict(),
  restricoes: z.object({ restricoes: list(z.object({ tipo: z.enum(['regiao','quantidade_minima','prazo','produto','modalidade','outra']), descricao: requiredText(2000) })) }).strict()
};

// Critérios observáveis, independentes de score, plano e regra de match.
// Ausência de certificações/restrições não penaliza empresas às quais não se aplicam.
export function profileCompletion(company, profile) {
  const p = profile.comercial;
  const criteria = {
    identificacao: !!(company.razao_social?.trim() && validCnpj(company.cnpj)),
    contato: !!(company.email && company.telefone),
    localizacao: !!(company.cidade && company.estado),
    cnae: profile.atividades.some(row => row.tipo === 'principal' && row.cnae),
    atividade_real: profile.atividades.some(row => row.tipo === 'efetiva' && row.descricao),
    catalogo: profile.produtos.some(row => row.nome && (row.descricao || row.especificacoes) && row.unidade),
    atendimento: profile.atendimento_nacional || profile.regioes.length > 0,
    capacidade: !!(p.capacidade_descricao || (p.capacidade_quantidade && p.capacidade_unidade && p.capacidade_periodo)),
    faixa: p.oportunidade_min !== null && p.oportunidade_min !== undefined,
    margem: p.margem_min !== null && p.margem_min !== undefined,
    prazo: !!(p.entrega_quantidade && p.entrega_unidade),
    documentos: profile.documentos.length > 0
  };
  const completed = Object.values(criteria).filter(Boolean).length;
  return { percentual: Math.round(completed / Object.keys(criteria).length * 100), preenchidos: completed, total: Object.keys(criteria).length, criterios: criteria };
}
