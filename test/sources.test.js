import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceRegistry } from '../src/services/sources/sourceRegistry.js';
import { createPncpSource } from '../src/services/sources/pncpSource.js';

test('createSourceRegistry lista e executa fontes registradas', async () => {
  const registry = createSourceRegistry({
    pncp: createPncpSource({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'S-1', objeto: 'Compra de tablets', dataAbertura: '2026-09-21T10:00:00Z', unidadeGestora: { nome: 'Diretoria de TI' }, modalidade: 'Pregão' }]
        })
      })
    }),
    demo: {
      id: 'demo',
      name: 'Demo',
      enabled: true,
      async fetchLatest() {
        return { source: 'demo', count: 1, items: [{ id: 'D-1', objeto: 'Teste de demo', dataAbertura: '2026-09-21T08:00:00Z', unidadeGestora: 'Demo', modalidade: 'N/D' }] };
      }
    }
  });

  const sources = registry.listSources();
  assert.equal(sources.length, 2);
  assert.ok(sources.some(source => source.id === 'pncp'));
  assert.deepEqual(registry.listSourceIds(true), ['demo', 'pncp']);

  const result = await registry.fetch('demo', { page: 2, pageSize: 5 });
  assert.equal(result.source, 'demo');
  assert.equal(result.items[0].id, 'D-1');

  const pncpResult = await registry.fetch('pncp', { page: 1, pageSize: 10 });
  assert.equal(pncpResult.source, 'pncp');
  assert.equal(pncpResult.items.length, 1);
  assert.equal(pncpResult.items[0].id, 'S-1');

  await assert.rejects(() => registry.fetch('missing'), /fonte/i);
});
