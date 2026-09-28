import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { persistPncpItems } from '../src/services/pncpPersistenceService.js';
import { normalizePncpItems } from '../src/services/sources/pncpSource.js';
import { normalizeComprasnetItems } from '../src/services/sources/comprasnetSource.js';
import { opportunityService, correlateOpportunities } from '../src/services/opportunityService.js';
import { accountRepository } from '../src/repositories/accountRepository.js';
import { createOperationsService } from '../src/services/operationsService.js';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';

const base = { id: 'regional', objeto: 'Compra de notebooks', dataAbertura: '2026-09-25', unidadeGestora: 'Secretaria' };

test('fontes preservam UF e distinguem IDs PNCP de códigos Compras.gov', () => {
  const pncp = normalizePncpItems([{ ...base, unidadeOrgao: { nomeUnidade: 'Secretaria', ufSigla: ' rn ' }, modalidadeId: 7 }])[0];
  assert.equal(pncp.uf, 'RN');
  assert.equal(pncp.modalidade, 'Pregão - Presencial');
  const compras = normalizeComprasnetItems([{ ...base, unidadeOrgaoUfSigla: 'PB', modalidadeIdPncp: 6, codigoModalidade: 5 }])[0];
  assert.equal(compras.uf, 'PB');
  assert.equal(compras.modalidade, 'Pregão - Eletrônico');
  const unknown = normalizeComprasnetItems([{ ...base, codigoModalidade: 6, modalidadeNome: 'Dispensa', unidadeOrgaoUfSigla: 'XX' }])[0];
  assert.equal(unknown.modalidade, 'Dispensa');
  assert.equal(unknown.uf, undefined);
});

test('regra regional filtra página, dashboard, novas filas e alertas pendentes nos dois canais', async () => {
  const db = new PGlite();
  const query = (sql, values) => sql.includes('pg_try_advisory_lock') ? Promise.resolve({ rows: [{ locked: true }] })
    : sql.includes('pg_advisory_unlock') ? Promise.resolve({ rows: [] }) : db.query(sql, values);
  const database = { query, connect: async () => ({ query, release() {} }) };
  let worker;
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email) VALUES ('Empresa','11222333000181','a@example.test');
      INSERT INTO usuarios (empresa_id,nome,email,senha_hash,tipo,alertas_email,whatsapp_numero,alertas_whatsapp,whatsapp_consentimento_em)
      VALUES (1,'Gestor','a@example.test','$2b$12$'||repeat('x',53),'gestor',true,'+5584999999999',true,now());
      INSERT INTO interesses (empresa_id,titulo,palavras) VALUES (1,'Notebooks',ARRAY['notebook']);`);
    const cases = [
      ['RN', 'Pregão - Eletrônico', true], ['PB', 'Pregão Presencial', true],
      ['RN', 'Pregão - Presencial', true], ['PB', 'Pregão Eletrônico', true],
      ['SP', 'Pregão Eletrônico', true], ['PE', 'Pregão Presencial', false],
      [null, 'Pregão Presencial', false], [null, 'Pregão Eletrônico', true],
      ['RN', 'Dispensa', false], ['PB', 'Concorrência Eletrônica', false],
      ['RN', 'Pregão', false], ['PB', 'N/D', false]
    ];
    const allowed = [];
    for (const [index, [uf, modalidade, expected]] of cases.entries()) {
      const id = `regional-${index}`;
      await persistPncpItems(database, [{ ...base, id, objeto: `${base.objeto} ${index}`, modalidade, uf }]);
      const { rows } = await db.query('SELECT id,licitacao_permitida(modalidade,uf) AS allowed FROM licitacoes_pncp WHERE codigo_externo=$1', [id]);
      assert.equal(rows[0].allowed, expected, `${uf}: ${modalidade}`);
      if (expected) allowed.push(id);
      // Stale matches remain positive: listings and delivery must independently enforce the rule.
      await db.query('INSERT INTO matches (interesse_id,licitacao_id,empresa_id,score) VALUES (1,$1,1,100)', [rows[0].id]);
    }
    const listing = await opportunityService(database).list(1, { page: 1, status: '', q: '', score: 0 });
    assert.equal(listing.total, allowed.length);
    assert.deepEqual(listing.items.map(item => item.codigo_externo).sort(), allowed.sort());
    const dashboard = await accountRepository(database).getDashboard(1);
    assert.equal(dashboard.oportunidades_totais, allowed.length);
    assert.equal(dashboard.topMatches.length, 5);
    assert.equal((await accountRepository(database).listCompanies())[0].oportunidades_totais, allowed.length);
    // A forbidden opportunity already queued must not escape the new rule.
    await db.exec(`INSERT INTO alertas (match_id,usuario_id,canal) SELECT m.id,1,c.canal FROM matches m
      JOIN licitacoes_pncp l ON l.id=m.licitacao_id CROSS JOIN (VALUES ('email'),('whatsapp')) c(canal)
      WHERE l.codigo_externo='regional-5';
      INSERT INTO tarefas (nome,proxima_execucao) VALUES ('matches',now()+interval '1 day');`);
    const sent = { email: 0, whatsapp: 0 };
    const delivery = channel => ({ sendMatchAlert: async () => { sent[channel]++; return { accepted: true, messageId: 'test' }; } });
    worker = createOperationsService({ database, config: { EMAIL_ENABLED: 'true', WHATSAPP_ENABLED: 'true', ALERT_MIN_SCORE: 70 },
      registry: createSourceRegistry(), logger: { error() {} }, emailService: delivery('email'), whatsappService: delivery('whatsapp') });
    await worker.runOnce();
    assert.deepEqual(sent, { email: allowed.length, whatsapp: allowed.length });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM alertas WHERE status='pendente'")).rows[0].n, 2);
    await correlateOpportunities(database);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM matches WHERE score>0')).rows[0].n, allowed.length);
    // Reimport enriches historic records without inserting or clearing known UF.
    const historical = { ...base, id: 'regional-6', objeto: `${base.objeto} 6`, modalidade: 'Pregão Presencial' };
    assert.equal(await persistPncpItems(database, [{ ...historical, uf: 'RN' }]), 0);
    await persistPncpItems(database, [historical]);
    assert.equal((await db.query("SELECT uf FROM licitacoes_pncp WHERE codigo_externo='regional-6'")).rows[0].uf, 'RN');
    await correlateOpportunities(database);
    assert.equal((await opportunityService(database).list(1, { page: 1, status: '', q: '', score: 0 })).total, allowed.length + 1);
    // Identical object/unit/date in different states must not be deduplicated together.
    assert.equal(await persistPncpItems(database, [{ ...base, id: 'state-rn', modalidade: 'Pregão Presencial', uf: 'RN' },
      { ...base, id: 'state-pe', modalidade: 'Pregão Presencial', uf: 'PE' }]), 2);
  } finally { await worker?.stop(); await db.close(); }
});
