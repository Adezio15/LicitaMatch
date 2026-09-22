import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateItems, normalizeItemSignature } from '../src/services/deduplicationService.js';

test('normalizeItemSignature cria uma chave estável para itens duplicados', () => {
  const a = {
    id: 'PNCP-001',
    objeto: 'Compra de computadores para a secretaria',
    dataAbertura: '2026-09-21T12:00:00Z',
    unidadeGestora: 'Secretaria da Fazenda',
    modalidade: 'Pregão Eletrônico'
  };

  const b = {
    id: 'CMP-999',
    objeto: 'Compra de computadores para a secretaria!',
    dataAbertura: '2026-09-21',
    unidadeGestora: 'Secretaria da Fazenda',
    modalidade: 'Pregão Eletrônico'
  };

  assert.equal(normalizeItemSignature(a), normalizeItemSignature(b));
});

test('deduplicateItems remove itens repetidos em diferentes fontes', () => {
  const items = [
    { source: 'pncp', id: 'PNCP-001', objeto: 'Compra de computadores para a secretaria', dataAbertura: '2026-09-21T12:00:00Z', unidadeGestora: 'Secretaria da Fazenda', modalidade: 'Pregão Eletrônico' },
    { source: 'comprasnet', id: 'CMP-999', objeto: 'Compra de computadores para a secretaria!', dataAbertura: '2026-09-21', unidadeGestora: 'Secretaria da Fazenda', modalidade: 'Pregão Eletrônico' },
    { source: 'pncp', id: 'PNCP-002', objeto: 'Serviço de manutenção predial', dataAbertura: '2026-09-22T09:15:00Z', unidadeGestora: 'Departamento de Obras', modalidade: 'Tomada de Preços' }
  ];

  const unique = deduplicateItems(items);
  assert.equal(unique.length, 2);
  assert.equal(unique[0].id, 'PNCP-001');
  assert.equal(unique[1].id, 'PNCP-002');
  assert.ok(unique.every(item => item.source));
});
