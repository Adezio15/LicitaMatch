import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../src/config/env.js', import.meta.url).href;
const injected = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@ep-example.neon.tech/neondb?sslmode=require&channel_binding=require',
  SESSION_SECRET: 'synthetic-runtime-secret-'.repeat(4)
};
const local = {
  DATABASE_URL: 'postgresql://local:synthetic@localhost/local_test',
  SESSION_SECRET: 'synthetic-local-secret-'.repeat(4)
};

function probe(env, withFile = true) {
  const cwd = mkdtempSync(join(tmpdir(), 'licitamatch-env-'));
  try {
    if (withFile) writeFileSync(join(cwd, '.env'), Object.entries(local).map(([key, value]) => `${key}=${value}`).join('\n'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const original = process.env;
      const before = JSON.stringify(process.env);
      const { loadEnvironment, parseEnv } = await import(${JSON.stringify(moduleUrl)});
      const importUnchanged = before === JSON.stringify(process.env);
      const messages = [];
      loadEnvironment({ info: message => messages.push(message) });
      let valid = false, issues;
      try { parseEnv(process.env); valid = true; } catch (error) { issues = error.issues; }
      process.stdout.write(JSON.stringify({
        importUnchanged, sameObject: original === process.env,
        valuesUnchanged: before === JSON.stringify(process.env),
        valid, issues, messages,
        usesRuntime: process.env.DATABASE_URL === ${JSON.stringify(injected.DATABASE_URL)} && process.env.SESSION_SECRET === ${JSON.stringify(injected.SESSION_SECRET)},
        usesLocal: process.env.DATABASE_URL === ${JSON.stringify(local.DATABASE_URL)} && process.env.SESSION_SECRET === ${JSON.stringify(local.SESSION_SECRET)}
      }));
    `], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    for (const value of [...Object.values(injected), ...Object.values(local)]) {
      assert.ok(!(result.stdout + result.stderr).includes(value));
    }
    return JSON.parse(result.stdout);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('produção usa process.env intacto com ou sem .env', () => {
  for (const withFile of [false, true]) {
    const result = probe({ NODE_ENV: 'production', ...injected }, withFile);
    assert.equal(result.valid, true);
    assert.equal(result.usesRuntime, true);
    assert.equal(result.importUnchanged, true);
    assert.equal(result.sameObject, true);
    assert.equal(result.valuesUnchanged, true);
    assert.deepEqual(result.messages, ['DATABASE_URL presente: true', 'SESSION_SECRET presente: true']);
  }
});

test('produção não preenche variáveis ausentes com arquivo .env', () => {
  const result = probe({ NODE_ENV: 'production' });
  assert.equal(result.valid, false);
  assert.equal(result.valuesUnchanged, true);
  assert.deepEqual(result.messages, ['DATABASE_URL presente: false', 'SESSION_SECRET presente: false']);
  assert.deepEqual(result.issues, [
    { field: 'DATABASE_URL', reason: 'MISSING' },
    { field: 'SESSION_SECRET', reason: 'MISSING' }
  ]);
});

test('Railway ignora .env mesmo sem NODE_ENV configurado', () => {
  for (const marker of ['RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID']) {
    const result = probe({ [marker]: 'synthetic-railway-id', ...injected });
    assert.equal(result.valid, true);
    assert.equal(result.usesRuntime, true);
    assert.equal(result.valuesUnchanged, true);
    assert.equal(probe({ [marker]: 'synthetic-railway-id' }).valid, false);
  }
});

test('desenvolvimento carrega .env explicitamente e preserva variáveis já injetadas', () => {
  const fromFile = probe({ NODE_ENV: 'development' });
  assert.equal(fromFile.importUnchanged, true);
  assert.equal(fromFile.sameObject, true);
  assert.equal(fromFile.valid, true);
  assert.equal(fromFile.usesLocal, true);
  const fromRuntime = probe({ NODE_ENV: 'development', ...injected });
  assert.equal(fromRuntime.valid, true);
  assert.equal(fromRuntime.valuesUnchanged, true);
  assert.equal(fromRuntime.usesRuntime, true);
});

test('presença significa definida; valor vazio é inválido, mas não MISSING', () => {
  const result = probe({ NODE_ENV: 'production', DATABASE_URL: '', SESSION_SECRET: '' });
  assert.equal(result.valid, false);
  assert.deepEqual(result.messages, ['DATABASE_URL presente: true', 'SESSION_SECRET presente: true']);
  assert.ok(result.issues.every(issue => issue.reason !== 'MISSING'));
});
