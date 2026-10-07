import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumTrialService } from '../src/services/premiumTrialService.js';
import { parseEnv } from '../src/config/env.js';

test('ADMIN_EMAIL é validado e aceita vazio como configuração ausente', () => {
  const base = { DATABASE_URL: 'postgresql://test:test@localhost/test', SESSION_SECRET: 'test-admin-email-secret-'.repeat(4) };
  assert.equal(parseEnv({ ...base, ADMIN_EMAIL: ' office@example.test ' }).ADMIN_EMAIL, 'office@example.test');
  assert.equal(parseEnv({ ...base, ADMIN_EMAIL: '' }).ADMIN_EMAIL, undefined);
  assert.throws(() => parseEnv({ ...base, ADMIN_EMAIL: 'invalid' }), /ADMIN_EMAIL/);
});

test('notificação administrativa prioriza ADMIN_EMAIL e mantém fallback de admins ativos', async () => {
  for (const configured of [true, false]) {
    const recipients = [];
    let adminQueries = 0;
    const database = { async query(sql, values) {
      if (sql.startsWith('SELECT * FROM empresas')) return { rows: [{ razao_social: 'Teste', cnpj: '11222333000181' }] };
      if (sql.startsWith('SELECT email FROM usuarios')) { adminQueries++; return { rows: [{ email: 'admin@example.test' }] }; }
      if (sql.startsWith('INSERT INTO notificacoes_plano')) { recipients.push(values[0]); return { rows: [] }; }
      throw new Error('Consulta inesperada');
    } };
    const service = premiumTrialService(database, { EMAIL_ENABLED: 'false', ...(configured ? { ADMIN_EMAIL: 'office@example.test' } : {}) });
    await service.contract({ id: 1, empresa_id: 1, nome: 'Gestor', email: 'user@example.test' }, 'pro');
    assert.deepEqual(recipients, [configured ? 'office@example.test' : 'admin@example.test']);
    assert.equal(adminQueries, configured ? 0 : 1);
  }
});
