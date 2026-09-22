import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { matchLicitacao } from './matchesService.js';
import { normalizeWhatsAppNumber } from './whatsappService.js';

const flag = z.union([z.boolean(), z.enum(['true', 'false'])]).transform(v => v === true || v === 'true');
export const interestSchema = z.object({
  titulo: z.string().trim().min(3).max(150),
  palavras: z.union([z.string().max(2000), z.array(z.string().max(100)).max(30)])
    .transform(v => [...new Set((Array.isArray(v) ? v : v.split(/[,;\n]/)).map(x => x.trim()).filter(Boolean))])
    .pipe(z.array(z.string().min(3).max(100)).min(1).max(30)),
  ativo: flag.default(true)
}).strict();
export const statusSchema = z.object({ status: z.enum(['novo', 'revisado', 'aceito', 'recusado']) }).strict();
export const alertPreferenceSchema = z.object({ alertas_email: flag }).strict();
export const whatsappPreferenceSchema = z.object({
  whatsapp_numero:z.string().max(30).transform((value,ctx)=>{
    try { return normalizeWhatsAppNumber(value); }
    catch (error) { ctx.addIssue({code:'custom',message:error.message}); return z.NEVER; }
  }),
  alertas_whatsapp:flag,
  confirmar_whatsapp:z.union([z.boolean(),z.literal('on')]).optional()
}).strict().superRefine((data,ctx)=>{
  if (data.alertas_whatsapp && (!data.whatsapp_numero || !data.confirmar_whatsapp)) {
    ctx.addIssue({code:'custom',message:'Informe seu celular e confirme que deseja receber alertas pelo WhatsApp.'});
  }
});
export const filterSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(['', 'novo', 'revisado', 'aceito', 'recusado']).default(''),
  q: z.string().trim().max(150).default(''),
  score: z.coerce.number().int().min(0).max(100).default(0)
});

// Batches bound memory; the full persisted catalog is considered for new interests.
export async function correlateOpportunities(database, empresaId = null) {
  const { rows: interests } = await database.query(`SELECT i.* FROM interesses i
    JOIN empresas e ON e.id=i.empresa_id WHERE i.ativo=true AND e.status='ativo'
    AND ($1::bigint IS NULL OR i.empresa_id=$1)`, [empresaId]);
  let cursor = '0', created = 0;
  while (interests.length) {
    const { rows } = await database.query('SELECT * FROM licitacoes_pncp WHERE id>$1 ORDER BY id LIMIT 250', [cursor]);
    if (!rows.length) break;
    for (const item of rows) for (const interest of interests) {
      const score = matchLicitacao(item, interest);
      if (!score) {
        await database.query('UPDATE matches SET score=0 WHERE interesse_id=$1 AND licitacao_id=$2 AND empresa_id=$3 AND score<>0', [interest.id,item.id,interest.empresa_id]);
        continue;
      }
      const result = await database.query(`INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score)
        SELECT id,$2,empresa_id,$3 FROM interesses WHERE id=$1 AND empresa_id=$4 AND ativo=true
        ON CONFLICT (interesse_id,licitacao_id) DO UPDATE SET score=EXCLUDED.score
        WHERE matches.score IS DISTINCT FROM EXCLUDED.score RETURNING id`, [interest.id, item.id, score, interest.empresa_id]);
      created += result.rows.length;
    }
    cursor = rows.at(-1).id;
  }
  return created;
}

export function opportunityService(database) {
  return {
    async interests(empresaId) {
      return (await database.query('SELECT * FROM interesses WHERE empresa_id=$1 ORDER BY ativo DESC, titulo, id', [empresaId])).rows;
    },
    async saveInterest(empresaId, data, id = null) {
      const { rows } = id
        ? await database.query(`UPDATE interesses SET titulo=$3,palavras=$4,ativo=$5
            WHERE empresa_id=$1 AND id=$2 RETURNING *`, [empresaId,id,data.titulo,data.palavras,data.ativo])
        : await database.query('INSERT INTO interesses (empresa_id,titulo,palavras,ativo) VALUES ($1,$2,$3,$4) RETURNING *',
          [empresaId,data.titulo,data.palavras,data.ativo]);
      if (!rows[0]) throw new HttpError(404, 'Interesse não encontrado');
      return rows[0];
    },
    async list(empresaId, filters) {
      const values = [empresaId,filters.status,filters.q,filters.score];
      const where = `m.empresa_id=$1 AND i.empresa_id=$1 AND i.ativo=true
        AND ($2='' OR m.status=$2) AND ($3='' OR strpos(lower(l.objeto),lower($3))>0)
        AND m.score > 0 AND m.score >= $4`;
      const from = `FROM matches m JOIN interesses i ON i.id=m.interesse_id
        JOIN licitacoes_pncp l ON l.id=m.licitacao_id WHERE ${where}`;
      const total = (await database.query(`SELECT count(*)::int AS total ${from}`, values)).rows[0].total;
      const { rows } = await database.query(`SELECT m.id,m.score,m.status,i.titulo AS interesse_titulo,
        l.codigo_externo,l.objeto,l.data_abertura,l.unidade_gestora,l.modalidade,l.origem,
        m.id AS match_id ${from} ORDER BY m.score DESC,m.id DESC LIMIT 20 OFFSET $5`, [...values,(filters.page-1)*20]);
      return { items: rows, total, pages: Math.max(1,Math.ceil(total/20)), filters };
    },
    async updateStatus(empresaId, id, status) {
      const { rows } = await database.query('UPDATE matches SET status=$3 WHERE empresa_id=$1 AND id=$2 RETURNING id,status', [empresaId,id,status]);
      if (!rows[0]) throw new HttpError(404, 'Oportunidade não encontrada');
      return rows[0];
    }
  };
}
