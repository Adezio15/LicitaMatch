import { assertFeature, companyPlan, assertOpportunityAccess } from './planService.js';
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
  segmento: z.string().regex(/^[1-9][0-9]{0,17}$/).or(z.literal('')).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(['', 'novo', 'revisado', 'aceito', 'recusado']).default(''),
  q: z.string().trim().max(150).default(''),
  score: z.coerce.number().int().min(0).max(100).default(0)
});

// Batches bound memory; the full persisted catalog is considered for new interests.
export async function correlateOpportunities(database, empresaId = null, logger, onMatchSaved) {
  const { rows: interests } = await database.query(`SELECT i.* FROM interesses i
    JOIN empresas e ON e.id=i.empresa_id WHERE i.ativo=true AND e.status='ativo' AND (e.plano='sem_plano' OR plano_efetivo(e) IN ('pro','premium'))
    AND ($1::bigint IS NULL OR i.empresa_id=$1)`, [empresaId]);
  logger?.info({ event: 'matches.start', interests: interests.length }, 'Início da análise de matches');
  const qualified = new Set();
  let found = 0;
  let cursor = '0', created = 0;
  while (interests.length) {
    const { rows } = await database.query('SELECT *, licitacao_permitida(modalidade,uf) AS permitida FROM licitacoes_pncp WHERE id>$1 ORDER BY id LIMIT 250', [cursor]);
    if (!rows.length) break;
    found += rows.length;
    for (const item of rows) for (const interest of interests) {
      const score = item.permitida ? matchLicitacao(item, interest) : 0;
      if (score >= 67) qualified.add(item.id);
      if (!score) {
        await database.query('UPDATE matches SET score=0 WHERE interesse_id=$1 AND licitacao_id=$2 AND empresa_id=$3 AND score<>0', [interest.id,item.id,interest.empresa_id]);
        continue;
      }
      const result = await database.query(`INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score)
        SELECT id,$2,empresa_id,$3 FROM interesses WHERE id=$1 AND empresa_id=$4 AND ativo=true
        ON CONFLICT (interesse_id,licitacao_id) DO UPDATE SET score=EXCLUDED.score
        WHERE matches.score IS DISTINCT FROM EXCLUDED.score RETURNING id`, [interest.id, item.id, score, interest.empresa_id]);
      created += result.rows.length;
      for (const match of result.rows) {
        const context = { matchId: match.id, empresaId: interest.empresa_id, licitacaoId: item.id,
          interesseId: interest.id, score };
        logger?.info({ event: 'match.created', ...context }, 'Match salvo');
        if (onMatchSaved) await onMatchSaved(database, context);
      }
    }
    cursor = rows.at(-1).id;
  }
  logger?.info({ event: 'matches.complete', found, matches67: qualified.size, updated: created }, 'Análise concluída: licitações distintas com match >= 67%');
  return created;
}

export function opportunityService(database) {
  return {
    async summary(empresaId) {
      const { rows } = await database.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE l.created_at > now()-interval '7 days')::int AS novas
        FROM licitacoes_pncp l WHERE licitacao_permitida(l.modalidade,l.uf)
        AND EXISTS (SELECT 1 FROM interesses i, unnest(i.palavras) palavra
          WHERE i.empresa_id=$1 AND i.ativo=true AND strpos(lower(l.objeto),lower(palavra))>0)`, [empresaId]);
      return { ...rows[0], locked: true, message: 'Encontramos oportunidades compatíveis com o perfil da sua empresa.' };
    },
    async search(empresaId, filters) {
      if (await companyPlan(database, empresaId) === 'sem_plano') return this.summary(empresaId);
      const where = `FROM licitacoes_pncp l WHERE licitacao_permitida(l.modalidade,l.uf)
        AND ($2='' OR strpos(lower(l.objeto),lower($2))>0)
        AND EXISTS (SELECT 1 FROM interesses i, unnest(i.palavras) palavra
          WHERE i.empresa_id=$1 AND i.ativo=true AND ($3::bigint IS NULL OR i.id=$3)
          AND strpos(lower(l.objeto),lower(palavra))>0)`;
      const values = [empresaId, filters.q, filters.segmento || null];
      const total = (await database.query(`SELECT count(*)::int AS total ${where}`, values)).rows[0].total;
      const items = (await database.query(`SELECT l.id,l.objeto,l.modalidade,l.uf,l.origem,l.unidade_gestora,l.codigo_externo,l.data_abertura ${where} ORDER BY l.id DESC LIMIT 20 OFFSET $4`, [...values,(filters.page-1)*20])).rows;
      return { items, total, pages: Math.max(1,Math.ceil(total/20)), filters };
    },
    async detail(empresaId,id) {
      assertOpportunityAccess(await companyPlan(database,empresaId));
      const item = (await database.query(`SELECT l.id,l.objeto,l.modalidade,l.uf,l.origem,l.unidade_gestora,l.codigo_externo,l.data_abertura
        FROM licitacoes_pncp l WHERE l.id=$2 AND licitacao_permitida(l.modalidade,l.uf)
        AND EXISTS (SELECT 1 FROM interesses i,unnest(i.palavras) palavra
          WHERE i.empresa_id=$1 AND i.ativo=true AND strpos(lower(l.objeto),lower(palavra))>0)`,[empresaId,id])).rows[0];
      if (!item) throw new HttpError(404,'Oportunidade não encontrada');
      return item;
    },
    async report(empresaId) {
      assertFeature(await companyPlan(database, empresaId), 'reports');
      return (await database.query(`SELECT m.status,count(*)::int AS total,round(avg(m.score))::int AS score_medio
        FROM matches m JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
        JOIN licitacoes_pncp l ON l.id=m.licitacao_id
        WHERE m.empresa_id=$1 AND i.ativo=true AND m.score>0 AND licitacao_permitida(l.modalidade,l.uf)
        GROUP BY m.status ORDER BY m.status`, [empresaId])).rows;
    },
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
      assertFeature(await companyPlan(database, empresaId), 'match');
      const values = [empresaId,filters.status,filters.q,filters.score];
      const where = `m.empresa_id=$1 AND i.empresa_id=$1 AND i.ativo=true
        AND ($2='' OR m.status=$2) AND ($3='' OR strpos(lower(l.objeto),lower($3))>0)
        AND m.score > 0 AND m.score >= $4 AND licitacao_permitida(l.modalidade,l.uf)`;
      const from = `FROM matches m JOIN interesses i ON i.id=m.interesse_id
        JOIN licitacoes_pncp l ON l.id=m.licitacao_id WHERE ${where}`;
      const total = (await database.query(`SELECT count(*)::int AS total ${from}`, values)).rows[0].total;
      const { rows } = await database.query(`SELECT m.id,m.score,m.status,i.titulo AS interesse_titulo,
        l.codigo_externo,l.objeto,l.data_abertura,l.unidade_gestora,l.modalidade,l.origem,l.uf,
        m.id AS match_id ${from} ORDER BY m.score DESC,m.id DESC LIMIT 20 OFFSET $5`, [...values,(filters.page-1)*20]);
      return { items: rows, total, pages: Math.max(1,Math.ceil(total/20)), filters };
    },
    async updateStatus(empresaId, id, status) {
      assertFeature(await companyPlan(database, empresaId), 'match');
      const { rows } = await database.query('UPDATE matches SET status=$3 WHERE empresa_id=$1 AND id=$2 RETURNING id,status', [empresaId,id,status]);
      if (!rows[0]) throw new HttpError(404, 'Oportunidade não encontrada');
      return rows[0];
    }
  };
}
