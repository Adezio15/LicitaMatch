import { z } from 'zod';
import { states } from '../utils/validation.js';
import { HttpError } from '../utils/httpError.js';
import { assertFeature, companyPlan } from './planService.js';
import { safeOfficialUrl } from './sources/officialLink.js';

export const reportTitles = { oportunidades: 'Oportunidades encontradas', matches: 'Matches por percentual', alertas: 'Alertas enviados', mensal: 'Desempenho mensal' };
export const statusLabels = { novo: 'Nova', revisado: 'Revisada', aceito: 'Aceita', recusado: 'Recusada' };
export const REPORT_TIMEZONE = 'America/Fortaleza';
export const PDF_MAX_ROWS = 2000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, 'Data inválida');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE }).format(new Date());
const monthAgo = () => { const value = new Date(`${today()}T12:00:00Z`); value.setUTCDate(value.getUTCDate()-29); return value.toISOString().slice(0,10); };
export const reportFilterSchema = z.object({
  tipo: z.enum(['oportunidades','matches','alertas','mensal']).default('oportunidades'),
  inicio: date.default(monthAgo), fim: date.default(today),
  interesse: z.string().regex(/^[1-9][0-9]{0,17}$/).or(z.literal('')).default(''),
  orgao: z.string().trim().max(200).default(''),
  estado: z.enum(states).or(z.literal('')).default(''),
  match_min: z.coerce.number().int().min(0).max(100).default(0),
  match_max: z.coerce.number().int().min(0).max(100).default(100),
  page: z.coerce.number().int().min(1).max(100000).default(1)
}).superRefine((value, ctx) => {
  if (value.inicio > value.fim) ctx.addIssue({code:'custom',message:'A data inicial deve ser anterior ou igual à final.'});
  if ((Date.parse(value.fim)-Date.parse(value.inicio))/86400000 > 3660) ctx.addIssue({code:'custom',message:'Selecione um período de até dez anos.'});
  if (value.match_min > value.match_max) ctx.addIssue({code:'custom',message:'O match mínimo deve ser menor ou igual ao máximo.'});
});

// One filtered dataset feeds screen and PDF. Company scope is always server-side.
const withinPeriod = column => `${column} >= ($2::date::timestamp AT TIME ZONE '${REPORT_TIMEZONE}')
  AND ${column} < (($3::date + 1)::timestamp AT TIME ZONE '${REPORT_TIMEZONE}')`;
const ctes = `WITH base AS (
  SELECT m.id AS match_id,m.empresa_id,m.licitacao_id,m.interesse_id,m.score,m.status,m.created_at AS encontrada_em,
    i.titulo AS interesse_titulo,l.objeto AS titulo,l.unidade_gestora AS orgao,l.cidade,l.uf,l.data_abertura,l.url_fonte
  FROM matches m JOIN interesses i ON i.id=m.interesse_id AND i.empresa_id=m.empresa_id
  JOIN licitacoes_pncp l ON l.id=m.licitacao_id
  WHERE m.empresa_id=$1 AND m.score>0 AND licitacao_permitida(l.modalidade,l.uf)
    AND ($4::bigint IS NULL OR m.interesse_id=$4)
    AND ($5='' OR strpos(lower(l.unidade_gestora),lower($5))>0)
    AND ($6='' OR l.uf=$6) AND m.score BETWEEN $7 AND $8
), encontrados AS (
  SELECT * FROM base WHERE ${withinPeriod('encontrada_em')}
), oportunidades AS (
  SELECT DISTINCT ON (licitacao_id) * FROM encontrados ORDER BY licitacao_id,score DESC,match_id
), envios AS (
  SELECT 'email'::text AS canal,a.id AS alerta_id,a.enviado_em,b.*
  FROM alertas_empresa_email a JOIN base b ON b.match_id=a.match_id AND b.empresa_id=a.empresa_id AND b.licitacao_id=a.licitacao_id
  WHERE a.status='enviado' AND ${withinPeriod('a.enviado_em')}
  UNION ALL
  SELECT 'whatsapp'::text AS canal,a.id AS alerta_id,a.enviado_em,b.*
  FROM alertas a JOIN base b ON b.match_id=a.match_id
  JOIN usuarios u ON u.id=a.usuario_id AND u.empresa_id=b.empresa_id
  WHERE a.canal='whatsapp' AND a.status='enviado' AND ${withinPeriod('a.enviado_em')}
)`;

const queries = {
  oportunidades: 'SELECT * FROM oportunidades ORDER BY encontrada_em DESC,licitacao_id DESC',
  matches: `SELECT faixa,count(*)::int AS total,round(avg(score),1)::float AS score_medio FROM (
    SELECT CASE WHEN score<25 THEN '01–24%' WHEN score<50 THEN '25–49%' WHEN score<75 THEN '50–74%' ELSE '75–100%' END AS faixa,score
    FROM encontrados) grouped GROUP BY faixa ORDER BY faixa`,
  alertas: 'SELECT * FROM envios ORDER BY enviado_em DESC,canal,alerta_id DESC',
  mensal: `SELECT to_char(mes,'YYYY-MM') AS mes,
    COALESCE(m.oportunidades,0)::int AS oportunidades,COALESCE(m.matches,0)::int AS matches,
    COALESCE(m.score_medio,0)::float AS score_medio,COALESCE(m.aceitos,0)::int AS aceitos,
    COALESCE(a.emails,0)::int AS emails,COALESCE(a.whatsapp,0)::int AS whatsapp
    FROM generate_series(date_trunc('month',$2::date::timestamp),date_trunc('month',$3::date::timestamp),interval '1 month') mes
    LEFT JOIN (SELECT date_trunc('month',encontrada_em AT TIME ZONE '${REPORT_TIMEZONE}') AS periodo,
      count(DISTINCT licitacao_id) AS oportunidades,count(*) AS matches,round(avg(score),1) AS score_medio,
      count(*) FILTER (WHERE status='aceito') AS aceitos FROM encontrados GROUP BY periodo) m ON m.periodo=mes
    LEFT JOIN (SELECT date_trunc('month',enviado_em AT TIME ZONE '${REPORT_TIMEZONE}') AS periodo,
      count(*) FILTER (WHERE canal='email') AS emails,count(*) FILTER (WHERE canal='whatsapp') AS whatsapp
      FROM envios GROUP BY periodo) a ON a.periodo=mes ORDER BY mes DESC`
};

export function reportService(database) {
  return {
    async run(empresaId, filters, { pdf = false } = {}) {
      assertFeature(await companyPlan(database, empresaId), 'reports');
      const f = reportFilterSchema.parse(filters);
      const params = [empresaId,f.inicio,f.fim,f.interesse || null,f.orgao,f.estado,f.match_min,f.match_max];
      const query = queries[f.tipo];
      const total = (await database.query(`${ctes} SELECT count(*)::int AS total FROM (${query}) report`,params)).rows[0].total;
      if (pdf && total > PDF_MAX_ROWS) throw new HttpError(422, `O PDF permite até ${PDF_MAX_ROWS} registros. Refine os filtros para exportar todos os resultados do período selecionado.`);
      const pageSize = pdf ? PDF_MAX_ROWS : 25;
      const offset = pdf ? 0 : (f.page-1)*pageSize;
      const rows = (await database.query(`${ctes} ${query} LIMIT $9 OFFSET $10`,[...params,pageSize,offset])).rows
        .map(row => 'url_fonte' in row ? {...row,url_fonte:safeOfficialUrl(row.url_fonte)} : row);
      // Preserve the original status-summary API alongside the new report rows.
      const items = (await database.query(`${ctes} SELECT status,count(*)::int AS total,round(avg(score))::int AS score_medio FROM encontrados GROUP BY status ORDER BY status`,params)).rows;
      return { title: reportTitles[f.tipo], tipo:f.tipo,filters:f,rows,items,total,pages:Math.max(1,Math.ceil(total/pageSize)),pageSize };
    },
    async interests(empresaId) {
      return (await database.query('SELECT id,titulo,ativo FROM interesses WHERE empresa_id=$1 ORDER BY titulo,id',[empresaId])).rows;
    }
  };
}
