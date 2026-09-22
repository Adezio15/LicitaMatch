import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { parseEnv } from '../src/config/env.js';

const production = {
  NODE_ENV: 'production', LOCAL_DATABASE: 'false', PORT: '8080',
  TRUST_PROXY_HOPS: '1', APP_TIMEZONE: 'America/Fortaleza',
  SESSION_SECRET: randomBytes(48).toString('hex')
};
const authority = 'neon_owner:synthetic%40password%3Awith%2Fsymbols%26more@ep-example-pooler.us-east-2.aws.neon.tech:5432/neondb';
const neonUrl = `postgresql://${authority}?sslmode=require&channel_binding=require`;

test('produção aceita protocolos PostgreSQL e parâmetros Neon sem alterar a URL', () => {
  for (const protocol of ['postgresql', 'postgres', 'POSTGRESQL', 'POSTGRES']) {
    for (const query of ['', '?sslmode=require', '?sslmode=require&channel_binding=require', '?sslmode=verify-full&channel_binding=require']) {
      const url = `${protocol}://${authority}${query}`;
      const direct = url.replace('-pooler', '');
      const config = parseEnv({ ...production, DATABASE_URL: url, DATABASE_DIRECT_URL: direct });
      assert.equal(config.DATABASE_URL, url);
      assert.equal(config.DATABASE_DIRECT_URL, direct);
      assert.equal(config.PORT, 8080);
      assert.equal(config.TRUST_PROXY_HOPS, 1);
      // Parse with the installed production driver too; no network connection here.
      const client = new pg.Client({ connectionString: config.DATABASE_URL });
      assert.equal(client.host, 'ep-example-pooler.us-east-2.aws.neon.tech');
      assert.equal(client.database, 'neondb');
      assert.equal(client.password, 'synthetic@password:with/symbols&more');
      if (query) assert.ok(client.ssl);
    }
  }
});

test('rejeições indicam exatamente a regra sem imprimir valores recebidos', () => {
  const cases = [
    [undefined, 'MISSING'], ['', 'EMPTY'], [42, 'INVALID_TYPE'],
    [` ${neonUrl}`, 'SURROUNDING_WHITESPACE'], [`${neonUrl}\n`, 'SURROUNDING_WHITESPACE'],
    [`'${neonUrl}'`, 'QUOTED_VALUE'], [`"${neonUrl}"`, 'QUOTED_VALUE'],
    [`psql '${neonUrl}'`, 'COMMAND_INSTEAD_OF_URL'],
    [`DATABASE_URL=${neonUrl}`, 'COMMAND_INSTEAD_OF_URL'],
    ['${{Postgres.DATABASE_URL}}', 'UNRESOLVED_REFERENCE'],
    ['not-a-url-private', 'MALFORMED_URL'],
    ['https://example.test', 'POSTGRES_PROTOCOL_REQUIRED'],
    ['postgresql:neondb', 'POSTGRES_PROTOCOL_REQUIRED'],
    ['postgresql:///neondb', 'HOST_REQUIRED']
  ];
  for (const [value, reason] of cases) {
    for (const field of ['DATABASE_URL', 'DATABASE_DIRECT_URL']) {
      if (field === 'DATABASE_DIRECT_URL' && (value === undefined || value === '')) continue;
      assert.throws(() => parseEnv({ ...production, DATABASE_URL: neonUrl, [field]: value }), error => {
        assert.equal(error.code, 'INVALID_ENV');
        assert.deepEqual(error.issues, [{ field, reason }]);
        const logged = JSON.stringify({ message: error.message, ...error });
        assert.ok(!logged.includes('synthetic'));
        assert.ok(!logged.includes('neon_owner'));
        assert.ok(!logged.includes('not-a-url-private'));
        return true;
      });
    }
  }
});

test('SESSION_SECRET rejeita placeholder, segredo curto e valores triviais', () => {
  for (const [value, reason] of [
    [undefined, 'MISSING'], ['short-private', 'MIN_48_CHARACTERS'],
    ['SUBSTITUA_POR_UM_NOVO_SEGREDO_ALEATORIO_DE_PELO_MENOS_48_CARACTERES', 'PLACEHOLDER_SECRET'],
    ['a'.repeat(64), 'WEAK_SECRET'], [' '.repeat(64), 'WEAK_SECRET']
  ]) {
    assert.throws(() => parseEnv({ ...production, DATABASE_URL: neonUrl, SESSION_SECRET: value }), error => {
      assert.ok(error.issues.some(issue => issue.field === 'SESSION_SECRET' && issue.reason === reason));
      if (value) assert.ok(!error.message.includes(value));
      return true;
    });
  }
  assert.equal(parseEnv({ ...production, DATABASE_URL: neonUrl }).SESSION_SECRET, production.SESSION_SECRET);
});
