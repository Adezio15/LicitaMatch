import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { parseEnv } from '../src/config/env.js';

const production = {
  NODE_ENV: 'production', LOCAL_DATABASE: 'false', PORT: '8080', WORKER_ENABLED: 'false',
  TRUST_PROXY_HOPS: '1', APP_TIMEZONE: 'America/Fortaleza',
  SESSION_SECRET: randomBytes(48).toString('hex')
};
const authority = 'neon_owner:synthetic%40password%3Awith%2Fsymbols%26more@ep-example-pooler.us-east-2.aws.neon.tech:5432/neondb';
const neonUrl = `postgresql://${authority}?sslmode=require&channel_binding=require`;

test('defaults ativam Compras.gov e aguardam credenciais dos alertas', () => {
  const config = parseEnv({
    ...production,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
    SESSION_SECRET: randomBytes(48).toString('hex')
  });
  assert.equal(config.COMPRASNET_ENABLED, 'true');
  assert.equal(config.EMAIL_ENABLED, 'false');
  assert.equal(config.WHATSAPP_ENABLED, 'false');
});

test('worker exige conexão direta no Neon e SMTP completo quando habilitado', () => {
  assert.throws(() => parseEnv({...production,DATABASE_URL:neonUrl,WORKER_ENABLED:'true'}), /WORKER_REQUIRES_DIRECT_CONNECTION/);
  assert.throws(() => parseEnv({...production,DATABASE_URL:neonUrl,DATABASE_DIRECT_URL:neonUrl,WORKER_ENABLED:'true'}), /WORKER_REQUIRES_DIRECT_CONNECTION/);
  assert.equal(parseEnv({...production,DATABASE_URL:neonUrl,DATABASE_DIRECT_URL:neonUrl.replace('-pooler',''),WORKER_ENABLED:'true'}).WORKER_ENABLED,'true');
  assert.throws(() => parseEnv({...production,DATABASE_URL:neonUrl,EMAIL_ENABLED:'true'}), /SMTP_HOST/);
});

test('produção ativa Compras.gov por padrão e alertas somente com credenciais completas', () => {
  const base = { ...production, DATABASE_URL: neonUrl };
  assert.equal(parseEnv(base).COMPRASNET_ENABLED, 'true');
  assert.equal(parseEnv({ ...base, COMPRASNET_ENABLED: 'false' }).COMPRASNET_ENABLED, 'false');
  const smtp = { EMAIL_FROM: 'alerts@example.test', SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test', SMTP_PASSWORD: 'synthetic' };
  assert.equal(parseEnv({ ...base, ...smtp }).EMAIL_ENABLED, 'true');
  assert.equal(parseEnv({ ...base, ...smtp, EMAIL_ENABLED: 'false' }).EMAIL_ENABLED, 'false');
  const resend = parseEnv({ ...base, EMAIL_FROM: 'alerts@example.test', RESEND_API_KEY: 'synthetic' });
  assert.equal(resend.EMAIL_ENABLED, 'true');
  assert.equal(resend.EMAIL_PROVIDER, 'resend');
  assert.throws(() => parseEnv({ ...base, EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'alerts@example.test' }), /RESEND_API_KEY/);
  const whatsapp = { WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_API_VERSION: 'v23.0', WHATSAPP_TEMPLATE_NAME: 'alerta' };
  assert.equal(parseEnv({ ...base, ...whatsapp }).WHATSAPP_ENABLED, 'true');
  assert.equal(parseEnv({ ...base, ...whatsapp, WHATSAPP_ENABLED: 'false' }).WHATSAPP_ENABLED, 'false');
});

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
