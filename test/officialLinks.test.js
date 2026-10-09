import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { normalizePncpItems } from '../src/services/sources/pncpSource.js';
import { normalizeComprasnetItems } from '../src/services/sources/comprasnetSource.js';
import { safeOfficialUrl,officialLink } from '../src/services/sources/officialLink.js';
import { scrapeComprasnetHtml, scrapeComprasnetFallback } from '../src/services/sources/webScraper.js';
import { persistPncpItems } from '../src/services/pncpPersistenceService.js';
import { createEmailService } from '../src/services/emailService.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { createLogger } from '../src/utils/logger.js';

const official = 'https://portal.example.gov.br/edital/2026/42?origem=pncp&tipo=compra';
const item = { id:'12345678000199-1-000042-2026',objeto:'Compra de notebook',dataAbertura:'2026-10-10',unidadeGestora:'Secretaria',modalidade:'Pregão Eletrônico' };

test('links vêm do payload, preservam processo/portal e nunca são deduzidos pelo ID', () => {
  for (const normalize of [normalizePncpItems,normalizeComprasnetItems]) {
    assert.equal(normalize([item])[0].urlFonte,undefined);
    assert.equal(normalize([{...item,linkSistemaOrigem:official}])[0].urlFonte,official);
    assert.equal(normalize([{...item,urlEdital:official,linkSistemaOrigem:'https://portal.example.gov.br/'}])[0].urlFonte,official);
    assert.equal(normalize([{...item,linkSistemaOrigem:'https://portal.example.gov.br/',linkProcessoEletronico:official}])[0].urlFonte,official);
    assert.equal(normalize([{...item,linkSistemaOrigem:'https://portal.example.gov.br/'}])[0].urlFonte,'https://portal.example.gov.br/');
  }
  assert.equal(normalizePncpItems([{...item,unidadeOrgao:{nomeUnidade:'Secretaria',ufSigla:'RN',municipioNome:'Natal'}}])[0].cidade,'Natal');
  assert.equal(normalizeComprasnetItems([{...item,unidadeOrgaoMunicipioNome:'Natal'}])[0].cidade,'Natal');
  for (const url of ['javascript:alert(1)','data:text/html,<h1>x</h1>','file:///tmp/arquivo','https:portal.example.gov.br','https://user:secret@portal.example.gov.br/','/edital/42','https://portal.example.gov.br/\nx', 'https://portal.example.gov.br/\\x']) {
    assert.equal(safeOfficialUrl(url),null,url);
    assert.equal(officialLink({linkSistemaOrigem:url}),null);
  }
});

test('scraping resolve href real em relação à página e mantém página consultada como fallback',async () => {
  const page='https://portal.example.gov.br/consulta/42';
  const html=`<p>Processo: 2026/42.</p><p>Objeto: Compra de notebooks para a secretaria.</p><p>Órgão: Secretaria de Saúde.</p><p>Modalidade: Pregão Eletrônico.</p><p>Abertura: 2026-10-10</p>`;
  const linked=scrapeComprasnetHtml(`${html}<a href="../edital/42?a=1&amp;b=2">Consultar edital</a>`,page);
  assert.equal(linked[0].urlFonte,'https://portal.example.gov.br/edital/42?a=1&b=2');
  assert.equal(scrapeComprasnetHtml(html)[0].urlFonte,undefined);
  assert.equal(scrapeComprasnetHtml(html,page)[0].urlFonte,page);
  const result=await scrapeComprasnetFallback({baseUrl:page,fetchImpl:async()=>({ok:true,url:page,text:async()=>html})});
  assert.equal(result.items[0].urlFonte,page);
});

test('reimportação enriquece link e cidade sem perder valores e e-mail automático inclui fonte',async () => {
  const db=new PGlite();
  for(const m of await readMigrations()) await db.exec(m.sql);
  const query=(s,v)=>s.includes('pg_try_advisory_lock')?Promise.resolve({rows:[{locked:true}]}):s.includes('pg_advisory_unlock')?Promise.resolve({rows:[]}):db.query(s,v);
  const database={query,connect:async()=>({query,release(){}})};
  let worker;
  try {
    assert.equal(await persistPncpItems(database,[item]),1);
    assert.equal((await db.query('SELECT url_fonte FROM licitacoes_pncp')).rows[0].url_fonte,null);
    assert.equal(await persistPncpItems(database,[{...item,urlFonte:official,cidade:'Natal',uf:'RN'}]),0);
    assert.equal(await persistPncpItems(database,[item,{...item,urlFonte:'javascript:alert(1)'}]),0);
    assert.equal(await persistPncpItems(database,[{...item,urlFonte:'https://portal.example.gov.br/'}]),0);
    assert.deepEqual((await db.query('SELECT url_fonte,cidade FROM licitacoes_pncp')).rows,[{url_fonte:official,cidade:'Natal'}]);
    const duplicate={...item,id:'other-source-id',urlFonte:official,uf:'RN'};
    assert.equal(await persistPncpItems(database,[duplicate],'comprasnet'),0);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM licitacoes_pncp')).rows[0].total,1);
    await db.exec("INSERT INTO empresas (razao_social,cnpj,email,plano) VALUES ('Cliente','12345678000199','cliente@example.test','pro'); INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Informática',ARRAY['notebook']);");
    const messages=[];
    worker=createOperationsService({database,config:{EMAIL_ENABLED:'true',WHATSAPP_ENABLED:'false'},logger:createLogger('silent'),registry:createSourceRegistry(),
      emailService:createEmailService({transport:{sendMail:async message=>{messages.push(message);return {messageId:'email-link'};}}})});
    await worker.runOnce();
    assert.equal(messages.length,1);
    assert.ok(messages[0].text.includes(official));
    assert.ok(messages[0].html.includes(official.replaceAll('&','&amp;')));
    assert.match(messages[0].html,/target="_blank"/);
  }finally{await worker?.stop();await db.close();}
});

test('e-mail sem link ou com URL insegura informa indisponibilidade e escapa HTML',async () => {
  const service=createEmailService({transport:{sendMail:async()=>({messageId:'test'})}});
  for(const urlFonte of [undefined,'javascript:alert(1)']) {
    const {message}=await service.sendMatchAlert({to:'cliente@example.test',score:80,item:{objeto:'<script>x</script>',urlFonte}});
    assert.match(message.text,/Link oficial não disponível/);
    assert.match(message.html,/Link oficial não disponível/);
    assert.doesNotMatch(message.html,/<script>|javascript:/);
  }
});
