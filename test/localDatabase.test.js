import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalTarget } from '../scripts/lib/localPostgres.js';
import { parseEnv } from '../src/config/env.js';

test('provisionamento local recusa produção e conexões de outros bancos', () => {
  assert.throws(() => assertLocalTarget({ NODE_ENV: 'production' }), /development/);
  assert.throws(() => assertLocalTarget({ NODE_ENV: 'test' }), /development/);
  assert.throws(() => assertLocalTarget({ DATABASE_URL: 'postgresql://app:CHANGE_ME@remote.example/prod' }), /outro banco/);
  assert.throws(() => assertLocalTarget({ DATABASE_URL: 'postgresql://app:secret@localhost:5432/other' }), /outro banco/);
  assert.throws(() => assertLocalTarget({ DATABASE_DIRECT_URL: 'postgresql://app:secret@remote.example/prod' }), /outro banco/);
  assert.doesNotThrow(() => assertLocalTarget({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://postgres:CHANGE_ME@localhost:5432/licitamatch' }));
  assert.doesNotThrow(() => assertLocalTarget({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://licitamatch_app:secret@127.0.0.1:55432/licitamatch_dev?sslmode=disable' }));
});

test('configuração de produção não aceita ativar PostgreSQL local', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:secret@remote.example/prod?sslmode=verify-full', SESSION_SECRET: 'test-only-secret-'.repeat(5) };
  assert.throws(() => parseEnv({ ...env, LOCAL_DATABASE: 'true' }), /LOCAL_DATABASE/);
  assert.equal(parseEnv({ ...env, LOCAL_DATABASE: 'false' }).LOCAL_DATABASE, 'false');
});
