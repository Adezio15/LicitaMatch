import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { matchLicitacao, saveMatches, matchRepository } from '../src/services/matchesService.js';
import { correlateOpportunities } from '../src/services/opportunityService.js';

test('matchLicitacao calcula pontuação baseada em palavras-chave do interesse', () => {
  const score = matchLicitacao({
    objeto: 'Compra de computadores e serviços de infraestrutura de ti',
    modalidade: 'Pregão Eletrônico',
    unidadeGestora: 'Secretaria de Tecnologia'
  }, {
    palavras: ['computador', 'infraestrutura', 'tecnologia', 'serviço', 'ti']
  });

  assert.ok(score >= 70);
  assert.ok(score <= 100);
});

test('saveMatches salva correlação de licitação com interesse e evita duplicidade', async () => {
  const db = new PGlite();
  const client = { query: (sql, params) => db.query(sql, params) };

  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await db.exec(`INSERT INTO licitacoes_pncp (codigo_externo, objeto, data_abertura, unidade_gestora, modalidade, origem)
      VALUES ('MATCH-1', 'Compra de notebooks para a área de tecnologia', '2026-10-01T12:00:00Z', 'SEFAZ', 'Pregão Eletrônico', 'pncp')`);

    const created = await saveMatches(client, {
      interesseId: 1,
      titulo: 'Tecnologia e infraestrutura',
      palavras: ['tecnologia', 'notebook', 'infraestrutura'],
      empresaId: 1,
      licitacaoId: 1
    });

    assert.equal(created, 1);

    const repo = matchRepository(client);
    const rows = await repo.listByInteresse(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].score, 67);

    const repeated = await saveMatches(client, {
      interesseId: 1,
      titulo: 'Tecnologia e infraestrutura',
      palavras: ['tecnologia', 'notebook', 'infraestrutura'],
      empresaId: 1,
      licitacaoId: 1
    });

    assert.equal(repeated, 0);
  } finally {
    await db.close();
  }
});

test('both match writers only persist scores at or above 67', async () => {
  const db = new PGlite();
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    await db.exec(`INSERT INTO empresas (razao_social,cnpj,email,plano)
      VALUES ('Empresa','11222333000181','threshold@example.test','premium');
      INSERT INTO interesses (empresa_id,titulo,palavras)
      VALUES (1,'Equipamentos',ARRAY['notebook','monitor','impressora']);
      INSERT INTO licitacoes_pncp (codigo_externo,objeto,data_abertura,unidade_gestora,modalidade)
      VALUES ('ZERO','Compra de mesas',now(),'Secretaria','Pregão Eletrônico'),
      ('LOW','Compra de notebook',now(),'Secretaria','Pregão Eletrônico'),
      ('LIMIT','Compra de notebook e monitor',now(),'Secretaria','Pregão Eletrônico'),
      ('HIGH','Compra de notebook, monitor e impressora',now(),'Secretaria','Pregão Eletrônico');`);
    for (const [id, expected] of [[1,0],[2,0],[3,1],[4,1]]) {
      assert.equal(await saveMatches(db, { interesseId:1,empresaId:1,licitacaoId:id,
        palavras:['notebook','monitor','impressora'] }), expected);
    }
    assert.deepEqual((await db.query('SELECT score FROM matches ORDER BY score')).rows.map(r=>r.score), [67,100]);
    await db.exec('DELETE FROM matches');
    const notified = [];
    assert.equal(await correlateOpportunities(db, null, null, async (_,context) => notified.push(context.score)), 2);
    assert.deepEqual(notified, [67,100]);
    assert.deepEqual((await db.query('SELECT score FROM matches ORDER BY score')).rows.map(r=>r.score), [67,100]);
    await db.query('UPDATE interesses SET palavras=$1 WHERE id=1', [['notebook','monitor','impressora','scanner','projetor']]);
    assert.equal(await correlateOpportunities(db), 0);
    assert.deepEqual((await db.query('SELECT score FROM matches ORDER BY score')).rows.map(r=>r.score), [67,100]);
  } finally { await db.close(); }
});
