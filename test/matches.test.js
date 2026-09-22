import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../src/services/migrationService.js';
import { matchLicitacao, saveMatches, matchRepository } from '../src/services/matchesService.js';

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
      VALUES ('MATCH-1', 'Compra de notebooks para a área de tecnologia', '2026-10-01T12:00:00Z', 'SEFAZ', 'Pregão', 'pncp')`);

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
    assert.ok(rows[0].score >= 0);

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
