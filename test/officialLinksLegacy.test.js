import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcrypt';
import request from 'supertest';
import ejs from 'ejs';
import { validOfficialUrl, officialUrlFromRecord } from '../src/services/sources/officialUrl.js';
import { normalizePncpItems } from '../src/services/sources/pncpSource.js';
import { normalizeComprasnetItems } from '../src/services/sources/comprasnetSource.js';
import { persistPncpItems } from '../src/services/pncpPersistenceService.js';
import { readMigrations } from '../src/services/migrationService.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { correlateOpportunities } from '../src/services/opportunityService.js';

const link = 'https://pncp.gov.br/documento/edital.pdf';
const record = { id: '11222333000181-1-000001-2026', objeto: 'Compra de notebook', dataAbertura: '2026-10-07', unidadeGestora: 'Secretaria', modalidade: 'Pregão Eletrônico' };

test('links vêm exclusivamente do registro; prioridade e validação de URLs', () => {
  for (const value of [null, '', 'javascript:alert(1)', 'data:text/html,x', 'ftp://portal.gov.br/a', '//portal.gov.br/a', 'https://user:pass@portal.gov.br/a', 'https://', 'https://portal.gov.br/a\nb', 'https://portal.gov.br/\\evil']) assert.equal(validOfficialUrl(value), null);
  assert.equal(validOfficialUrl(' https://portal.gov.br/edital.pdf '), 'https://portal.gov.br/edital.pdf');
  assert.equal(officialUrlFromRecord({ linkEdital: link, linkSistemaOrigem: 'https://portal.gov.br/' }), link);
  assert.equal(officialUrlFromRecord({ linkEdital: 'javascript:alert(1)', linkProcessoEletronico: link }), link);
  for (const normalize of [normalizePncpItems, normalizeComprasnetItems]) {
    assert.equal(normalize([record])[0].link_edital, undefined); // Even a PNCP ID never creates a URL.
    assert.equal(normalize([{ ...record, linkSistemaOrigem: link }])[0].link_edital, link);
  }
});

test('persistência, enriquecimento e APIs/UI respeitam planos sem expor links no resumo', async () => {
  const db = new PGlite();
  const database = { query: (s,v) => db.query(s,v), connect: async () => ({query:(s,v)=>db.query(s,v),release(){}}) };
  const config = parseEnv({ NODE_ENV:'test', DATABASE_URL:'postgresql://test:test@localhost/test', SESSION_SECRET:'official-links-tests-secret-'.repeat(4) });
  const app = createApp({database,config,logger:createLogger('silent')});
  try {
    for (const m of await readMigrations()) await db.exec(m.sql);
    await persistPncpItems(database, [record]);
    assert.equal((await db.query('SELECT link_edital FROM licitacoes_pncp')).rows[0].link_edital, null);
    assert.equal(await persistPncpItems(database, [{...record,link_edital:link}]), 0);
    await persistPncpItems(database, [{...record,link_edital:'javascript:alert(1)'}]);
    assert.equal((await db.query('SELECT link_edital FROM licitacoes_pncp')).rows[0].link_edital, link);
    const hash = await bcrypt.hash('Senha-link-testes-2026!',4);
    const id = (await db.query('SELECT id FROM licitacoes_pncp')).rows[0].id;
    for (const [index,plan] of ['sem_plano','start','pro','premium'].entries()) {
      const company = (await db.query('INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ($1,$2,$3,$1) RETURNING id',[plan,String(index+1).padStart(14,'0'),`${plan}@test.dev`])).rows[0];
      await db.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo) VALUES ($1,$2,$3,$4,'gestor')",[company.id,plan,`${plan}@test.dev`,hash]);
      await db.query("INSERT INTO interesses (empresa_id,titulo,palavras) VALUES ($1,'Informática',ARRAY['notebook'])",[company.id]);
      await correlateOpportunities(database,company.id);
      const agent = request.agent(app);
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      await agent.post('/api/auth/login').set('X-CSRF-Token',csrf).send({email:`${plan}@test.dev`,senha:'Senha-link-testes-2026!'}).expect(200);
      for (const route of ['/api/busca','/api/oportunidades']) {
        const response = await agent.get(route).expect(200);
        if (plan==='sem_plano') {
          assert.equal(response.body.total,1);
          assert.equal(response.body.items,undefined);
          assert.doesNotMatch(response.text,/link_edital|url_oportunidade|https:\/\//);
        } else assert.equal(response.body.items[0].link_edital,link);
      }
      const detail = await agent.get(`/api/oportunidades/${id}`).expect(plan==='sem_plano'?403:200);
      if (plan==='sem_plano') assert.doesNotMatch(detail.text,/link_edital|url_oportunidade|https:\/\//);
      else {
        assert.equal(detail.body.item.link_edital,link);
        for (const route of ['/busca','/oportunidades',`/oportunidades/${id}`]) {
          const page = await agent.get(route).expect(200);
          assert.match(page.text,/↗ Ver edital/);
          assert.match(page.text,/target="_blank" rel="noopener noreferrer"/);
        }
      }
    }
    await db.exec('UPDATE licitacoes_pncp SET link_edital=NULL');
    // The migration preserves old records, and never manufactures a link.
    assert.equal((await db.query('SELECT link_edital FROM licitacoes_pncp')).rows[0].link_edital,null);
  } finally {app.locals.sessionStore.close(); await db.close();}
});

 test('sem link, interface explica ausência sem construir URL pelo identificador', async () => {
  const html = await ejs.renderFile('src/views/partials/officialLink.ejs', { user: {plano:'premium'}, item:{...record,link_edital:null} });
  assert.match(html,/Link oficial não disponível/);
  assert.doesNotMatch(html,/href=|Ver edital/);
 });
