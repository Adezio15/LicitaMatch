import assert from 'node:assert/strict';
import test from 'node:test';
import { createComprasnetSource, normalizeComprasnetItems } from '../src/services/sources/comprasnetSource.js';

test('normalizeComprasnetItems extrai itens válidos do portal complementar', () => {
  const payload = {
    itens: [
      {
        numero: '2026/001',
        descricao: 'Aquisição de veículos leves para frota',
        dataAbertura: '2026-09-20',
        orgao: { nome: 'Secretaria da Fazenda' },
        modalidade: 'Pregão Eletrônico'
      },
      {
        numero: '',
        descricao: '',
        dataAbertura: '',
        orgao: null,
        modalidade: 'Inexigível'
      }
    ]
  };

  const items = normalizeComprasnetItems(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '2026/001');
  assert.match(items[0].objeto, /veículos|veiculos/i);
  assert.equal(items[0].unidadeGestora, 'Secretaria da Fazenda');
  assert.equal(items[0].modalidade, 'Pregão Eletrônico');
});

test('createComprasnetSource consulta o portal complementar e rejeita falhas de rede', async () => {
  const okSource = createComprasnetSource({
    fetchImpl: async (url, init = {}) => {
      assert.match(String(url), /comprasnet/i);
      assert.equal(init.method || 'GET', 'GET');
      return {
        ok: true,
        json: async () => ({
          itens: [{
            numero: '2026/777',
            descricao: 'Serviço de manutenção predial',
            dataAbertura: '2026-09-21',
            orgao: { nome: 'Departamento de Obras' },
            modalidade: 'Tomada de Preços'
          }]
        })
      };
    }
  });

  const result = await okSource.fetchLatest({ page: 2, pageSize: 25 });
  assert.equal(result.source, 'comprasnet');
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, '2026/777');

  const failed = createComprasnetSource({
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => 'portal indisponível'
    })
  });

  await assert.rejects(() => failed.fetchLatest(), /500|portal indisponível/i);
});
