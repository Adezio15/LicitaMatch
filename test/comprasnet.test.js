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

test('createComprasnetSource consulta o portal complementar e usa fallback de scraping quando a API responde vazia', async () => {
  const okSource = createComprasnetSource({
    fetchImpl: async (url, init = {}) => {
      assert.equal(url.hostname, 'dadosabertos.compras.gov.br');
      assert.equal(url.searchParams.get('pagina'), '2');
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

  const fallbackSource = createComprasnetSource({
    fetchImpl: async (url, init = {}) => {
      if (String(init.headers?.Accept || '').includes('text/html')) {
        return { ok: true, headers: { get: name => name === 'content-type' ? 'text/html; charset=utf-8' : null }, text: async () => `
          <html><body>
            <div><span>Processo: 2026/888</span></div>
            <div><strong>Objeto:</strong> Compra de cadeiras para a secretaria</div>
            <div><strong>Órgão:</strong> Secretaria de Saúde</div>
            <div><strong>Modalidade:</strong> Pregão Eletrônico</div>
            <div><strong>Data de Abertura:</strong> 2026-09-23</div>
          </body></html>
        ` };
      }
      return { ok: true, json: async () => ({ resultado: [] }) };
    }
  });

  const fallbackResult = await fallbackSource.fetchLatest();
  assert.equal(fallbackResult.source, 'comprasnet');
  assert.ok(fallbackResult.items.some(item => item.id === '2026/888' && /cadeiras/i.test(item.objeto)));

  const failed = createComprasnetSource({
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => 'portal indisponível'
    })
  });

  await assert.rejects(() => failed.fetchLatest(), /500|portal indisponível|scraping/i);
});
