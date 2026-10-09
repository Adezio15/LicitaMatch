import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { readMigrations } from '../src/services/migrationService.js';
import { reportFilterSchema } from '../src/services/reportService.js';

const config=parseEnv({DATABASE_URL:'postgresql://test:test@localhost/test',NODE_ENV:'test',SESSION_SECRET:'report-test-session-'.repeat(4)});
const period={inicio:'2026-01-01',fim:'2026-02-28'};
const url='https://portal.example.gov.br/edital/42?origem=pncp&tipo=compra';
const password='Senha-relatorio-teste!';
const bufferParser=(res,done)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done(null,Buffer.concat(chunks)));};
// Inspect PDF page text streams as well as annotations, not just the HTTP status.
function pdfText(buffer) {
  const binary=buffer.toString('latin1');
  return [...binary.matchAll(/\/Length (\d+)\b[^]*?stream\r?\n/g)].map(match=>{
    const start = match.index + match[0].length;
    try { return [...inflateSync(buffer.subarray(start,start+Number(match[1]))).toString('latin1').matchAll(/<([\da-f]+)>/gi)]
      .map(m=>Buffer.from(m[1],'hex').toString('latin1')).join(''); } catch { return ''; }
  }).join('\n');
}

test('relatórios e PDFs: filtros, totais, links, paginação, isolamento e planos',async t=>{
  const db=new PGlite();
  for(const m of await readMigrations()) await db.exec(m.sql);
  const database={query:(s,v)=>db.query(s,v),connect:async()=>({query:(s,v)=>db.query(s,v),release(){}})};
  const app=createApp({database,config,logger:createLogger('silent')});
  try {
    const hash=await bcrypt.hash(password,4);
    const agents=[];
    for(let id=1;id<=4;id++) {
      await db.query('INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ($1,$2,$3,$4)',[`Empresa ${id}`,String(id).padStart(14,'0'),`${id}@test.dev`,['premium','premium','start','pro'][id-1]]);
      await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo) VALUES ($1,'Gestor',$2,$3,'gestor')",[id,`${id}@test.dev`,hash]);
      const agent=request.agent(app);
      const token=(await agent.get('/api/auth/csrf')).body.csrfToken;
      await agent.post('/api/auth/login').set('X-CSRF-Token',token).send({email:`${id}@test.dev`,senha:password}).expect(200);
      agents.push(agent);
    }
    await db.exec(`INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']),(1,'Saúde',ARRAY['compra']),(2,'SEGREDO',ARRAY['compra']);
      INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,cidade,uf) VALUES
      ('R1','Compra de notebook','2026-04-01','Secretaria de Saúde','Pregão Eletrônico','Natal','RN'),
      ('R2','Compra de impressora','2026-04-01','Secretaria de Educação','Pregão Eletrônico','São Paulo','SP'),
      ('R3','SEGREDO DE OUTRA EMPRESA','2026-04-01','Órgão secreto','Pregão Eletrônico','João Pessoa','PB'),
      ('R4','Compra de tablet','2026-04-01','Secretaria de Saúde','Pregão Eletrônico',NULL,'RN');
      INSERT INTO matches (empresa_id,interesse_id,licitacao_id,score,status,created_at) VALUES
      (1,1,1,80,'aceito','2026-01-15T12:00:00Z'),(1,2,1,95,'novo','2026-01-16T12:00:00Z'),
      (1,1,2,40,'novo','2026-02-01T02:59:00Z'),(1,1,4,60,'revisado','2026-02-01T03:00:00Z'),
      (2,3,3,100,'novo','2026-01-15T12:00:00Z'),(1,2,2,10,'novo','2026-03-01T12:00:00Z');
      INSERT INTO alertas_empresa_email (empresa_id,licitacao_id,match_id,status,enviado_em) VALUES
      (1,1,2,'enviado','2026-02-02T12:00:00Z'),(2,3,5,'enviado','2026-01-20T12:00:00Z'),(1,2,3,'falhou',NULL);
      INSERT INTO alertas (match_id,usuario_id,canal,status,enviado_em) VALUES
      (1,1,'whatsapp','enviado','2026-01-17T12:00:00Z'),(3,1,'whatsapp','pendente',NULL),
      (1,1,'email','enviado','2026-01-17T12:00:00Z');`);
    await db.query('UPDATE licitacoes_pncp SET url_fonte=$1 WHERE id=1',[url]);
    const agent=agents[0];
    const get=async filters=>(await agent.get('/api/relatorios').query({...period,...filters}).expect(200)).body;

    await t.test('oportunidades deduplicadas, link preservado e filtros combinados',async()=>{
      const report=await get({});
      assert.equal(report.total,3);
      assert.equal(report.rows.find(r=>r.licitacao_id===1).score,95);
      assert.equal(report.rows.find(r=>r.licitacao_id===1).url_fonte,url);
      assert.ok(report.rows.every(r=>r.empresa_id===1));
      const filtered=await get({interesse:'1',orgao:'saúde',estado:'RN',match_min:70,match_max:90});
      assert.equal(filtered.total,1);
      assert.equal(filtered.rows[0].score,80);
      assert.equal(filtered.rows[0].cidade,'Natal');
      assert.equal((await get({interesse:'3',empresa_id:2})).total,0);
      assert.equal((await get({orgao:"' OR 1=1 --"})).total,0);
      const jan31=await get({inicio:'2026-01-31',fim:'2026-01-31'});
      assert.deepEqual(jan31.rows.map(r=>r.licitacao_id),[2]);
      const feb1=await get({inicio:'2026-02-01',fim:'2026-02-01'});
      assert.deepEqual(feb1.rows.map(r=>r.licitacao_id),[4]);
    });
    await t.test('faixas, alertas confirmados e desempenho mensal usam eventos corretos sem duplicar e-mails',async()=>{
      const bands=await get({tipo:'matches'});
      assert.deepEqual(bands.rows.map(r=>[r.faixa,r.total]),[['25–49%',1],['50–74%',1],['75–100%',2]]);
      const alerts=await get({tipo:'alertas'});
      assert.equal(alerts.total,2);
      assert.deepEqual(alerts.rows.map(r=>r.canal),['email','whatsapp']);
      const sent=await get({tipo:'alertas',inicio:'2026-02-01',interesse:'2',match_min:90});
      assert.equal(sent.total,1);
      assert.equal(sent.rows[0].url_fonte,url);
      const monthly=await get({tipo:'mensal'});
      assert.deepEqual(monthly.rows,[
        {mes:'2026-02',oportunidades:1,matches:1,score_medio:60,aceitos:0,emails:1,whatsapp:0},
        {mes:'2026-01',oportunidades:2,matches:3,score_medio:71.7,aceitos:1,emails:0,whatsapp:1}
      ]);
      const empty=await get({tipo:'mensal',estado:'AC'});
      assert.ok(empty.rows.every(r=>r.matches===0 && r.emails===0 && r.whatsapp===0));
    });
    await t.test('HTML e PDF dos quatro relatórios exibem dados sem vazar outra empresa',async()=>{
      for(const tipo of ['oportunidades','matches','alertas','mensal']) {
        const page=await agent.get('/relatorios').query({...period,tipo}).expect(200);
        assert.doesNotMatch(page.text,/SEGREDO/);
        assert.match(page.text,/Exportar em PDF/);
        const pdf=await agent.get('/relatorios/pdf').query({...period,tipo}).buffer(true).parse(bufferParser).expect(200).expect('Content-Type',/application\/pdf/);
        assert.match(pdf.headers['content-disposition'],/attachment/);
        assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
        const extracted=pdfText(pdf.body);
        assert.match(extracted,/LicitaMatch/);
        assert.doesNotMatch(extracted,/SEGREDO/);
        if(['oportunidades','alertas'].includes(tipo)) {
          assert.ok(pdf.body.toString('latin1').includes(`/URI (${url})`));
          assert.match(extracted,/Compra de notebook/);
          assert.match(page.text,/target="_blank"/);
          assert.ok(page.text.includes(url.replaceAll('&','&amp;')));
        }
        if(tipo==='oportunidades') {
          assert.match(extracted,/Link oficial não disponível/);
          assert.match(extracted,/Natal/);
          assert.match(page.text,/Link oficial não disponível/);
        }
      }
      const page=await agent.get('/oportunidades').expect(200);
      assert.ok(page.text.includes(url.replaceAll('&','&amp;')));
      assert.match(page.text,/Link oficial não disponível/);
      const search=await agent.get('/busca').expect(200);
      assert.ok(search.text.includes(url.replaceAll('&','&amp;')));
    });
    await t.test('validação, plano e escopo também protegem PDF e API',async()=>{
      for(const filters of [{inicio:'2026-02-30'},{inicio:'2027-01-01',fim:'2026-01-01'},{match_min:90,match_max:20},{estado:'XX'},{interesse:'1 OR 1=1'},{tipo:'outro'}]) {
        await agent.get('/api/relatorios').query({...period,...filters}).expect(422);
        await agent.get('/api/relatorios/pdf').query({...period,...filters}).expect(422);
      }
      for(const path of ['/relatorios','/api/relatorios','/relatorios/pdf','/api/relatorios/pdf']) {
        for(const lower of agents.slice(2)) await lower.get(path).query(period).expect(403);
      }
      await request(app).get('/api/relatorios/pdf').query(period).expect(401);
      const foreign=(await agents[1].get('/api/relatorios').query({...period,empresa_id:1}).expect(200)).body;
      assert.equal(foreign.rows.length,1);
      assert.equal(foreign.rows[0].titulo,'SEGREDO DE OUTRA EMPRESA');
    });
    await t.test('PDF exporta todas as páginas dos filtros e estado vazio é válido',async()=>{
      await db.exec(`INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,uf)
        SELECT 'PAG-'||n,'Registro paginado '||n,'2026-04-01','Órgão paginado','Pregão Eletrônico','RN' FROM generate_series(1,27) n;
        INSERT INTO matches (empresa_id,interesse_id,licitacao_id,score,created_at)
        SELECT 1,1,id,85,'2026-01-20' FROM licitacoes_pncp WHERE codigo_externo LIKE 'PAG-%';`);
      const data=await get({});
      assert.equal(data.total,30);
      assert.equal(data.rows.length,25);
      assert.equal((await get({page:2})).rows.length,5);
      const pdf=await agent.get('/api/relatorios/pdf').query({...period,page:2}).buffer(true).parse(bufferParser).expect(200);
      const extracted=pdfText(pdf.body);
      assert.match(extracted,/Registro paginado 27/);
      assert.match(extracted,/Compra de notebook/);
      assert.ok((pdf.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length>1);
      const empty=await agent.get('/api/relatorios/pdf').query({...period,estado:'AC'}).buffer(true).parse(bufferParser).expect(200);
      assert.match(pdfText(empty.body),/Nenhum resultado/);
      await db.exec(`INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade,uf)
        SELECT 'LIM-'||n,'Limite PDF '||n,'2026-04-01','Órgão paginado','Pregão Eletrônico','RN' FROM generate_series(1,2000) n;
        INSERT INTO matches (empresa_id,interesse_id,licitacao_id,score,created_at)
        SELECT 1,1,id,85,'2026-01-20' FROM licitacoes_pncp WHERE codigo_externo LIKE 'LIM-%';`);
      const limit=await agent.get('/api/relatorios/pdf').query(period).expect(422);
      assert.match(limit.body.error,/Refine os filtros/);
    });
  }finally{app.locals.sessionStore.close();await db.close();}
});

test('filtros de datas usam valores reais e faixas válidas',()=>{
  assert.equal(reportFilterSchema.safeParse({inicio:'2024-02-29',fim:'2024-02-29'}).success,true);
  assert.equal(reportFilterSchema.safeParse({inicio:'2025-02-29',fim:'2025-02-29'}).success,false);
  assert.equal(reportFilterSchema.safeParse({match_min:101}).success,false);
});
