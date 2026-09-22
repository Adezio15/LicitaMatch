import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPncpSource, normalizePncpItems } from '../src/services/sources/pncpSource.js';
import { readMigrations, runMigrations } from '../src/services/migrationService.js';
import { persistPncpItems, pncpRepository } from '../src/services/pncpPersistenceService.js';

test('normalizePncpItems extrai somente itens válidos do payload do PNCP', () => {
  const payload = {
    data: [
      {
        id: 'A-123',
        objeto: 'Compra de computadores para a unidade de TI',
        dataAbertura: '2026-09-21T12:00:00Z',
        unidadeGestora: { nome: 'Secretaria de Administração' },
        modalidade: 'Pregão Eletrônico'
      },
      {
        id: 'B-999',
        objeto: '',
        dataAbertura: '',
        unidadeGestora: null,
        modalidade: 'Inexigível'
      }
    ]
  };

  const items = normalizePncpItems(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'A-123');
  assert.match(items[0].objeto, /computadores/i);
  assert.equal(items[0].unidadeGestora, 'Secretaria de Administração');
});

test('createPncpSource busca o feed público e rejeita falhas da API', async () => {
  const source = createPncpSource({
    fetchImpl: async (url, init = {}) => {
      assert.match(String(url), /pncp/i);
      assert.equal(init.method || 'GET', 'GET');
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: 'PNCP-0001',
            objeto: 'Contratação de serviço de nuvem',
            dataAbertura: '2026-09-20T18:30:00Z',
            unidadeGestora: { nome: 'Diretoria de TI' },
            modalidade: 'Dispensa'
          }]
        })
      };
    }
  });

  const result = await source.fetchLatest({ page: 1, pageSize: 10 });
  assert.equal(result.source, 'pncp');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'PNCP-0001');

  const failed = createPncpSource({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => 'serviço indisponível'
    })
  });

  await assert.rejects(() => failed.fetchLatest(), /503|serviço indisponível/i);
});

test('persistPncpItems grava itens válidos em banco e evita duplicidade por código externo', async () => {
  const db = new PGlite();
  const client = {
    query: (sql, params) => db.query(sql, params)
  };
  try {
    for (const migration of await readMigrations()) await db.exec(migration.sql);
    const persisted = await persistPncpItems(client, [
      { id: 'PNCP-001', objeto: 'Aquisição de laptops', dataAbertura: '2026-09-21T12:00:00Z', unidadeGestora: 'SEFAZ', modalidade: 'Pregão' },
      { id: 'PNCP-001', objeto: 'Aquisição de laptops', dataAbertura: '2026-09-21T12:00:00Z', unidadeGestora: 'SEFAZ', modalidade: 'Pregão' },
      { id: 'PNCP-002', objeto: '', dataAbertura: '', unidadeGestora: '', modalidade: 'N/D' }
    ]);
    assert.equal(persisted, 1);
    const rows = await db.query('SELECT codigo_externo, objeto, unidade_gestora FROM licitacoes_pncp ORDER BY codigo_externo');
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].codigo_externo, 'PNCP-001');
    const repo = pncpRepository(client);
    const list = await repo.listLatest();
    assert.equal(list.length, 1);
    assert.equal(list[0].codigo_externo, 'PNCP-001');
  } finally {
    await db.close();
  }
});
