import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnvironment, postgresUrl } from '../src/config/env.js';
import { createOfficialApiClient } from '../src/services/sources/officialLinkResolver.js';
import { createHistoricalLinkResolver, previewLinkRecovery, applyLinkRecovery, confirmationFor } from '../src/services/officialLinkRecoveryService.js';

let client;
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output','--limit','--max-requests','--apply','--confirm'].includes(args[i]) || !args[i + 1] || options[args[i]])
      throw new Error('Use --output ARQUIVO [--limit 50] [--max-requests 50] ou --apply ARQUIVO --confirm TOKEN.');
    options[args[i]] = args[i + 1];
  }
  if (options['--apply'] ? !options['--confirm'] || Object.keys(options).some(key => !['--apply','--confirm'].includes(key))
    : !options['--output'] || options['--confirm']) throw new Error('Prévia exige --output; aplicação exige somente --apply e --confirm.');
  const limit = Number(options['--limit'] || 50), maxRequests = Number(options['--max-requests'] || 50);
  if (![limit,maxRequests].every(n => Number.isInteger(n) && n >= 1 && n <= 500)) throw new Error('Limites devem estar entre 1 e 500.');
  loadEnvironment();
  const connectionString = postgresUrl.parse(process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL);
  const database = createHash('sha256').update(connectionString).digest('hex');
  const manifest = options['--apply'] ? JSON.parse(await readFile(options['--apply'], 'utf8')) : null;
  // Reject mismatched confirmation before opening any database connection.
  if (options['--apply'] && (!manifest || manifest.version !== 1 || !Array.isArray(manifest.results) || manifest.database !== database || confirmationFor(manifest) !== options['--confirm'])) throw new Error('Confirmação ou banco não corresponde à prévia.');
  client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000,
    application_name: 'licitamatch-official-links-recovery' });
  await client.connect();
  if (manifest) {
    console.log(JSON.stringify({ event: 'official_links.recovery.applied', ...await applyLinkRecovery(client, manifest, options['--confirm'], database) }));
  } else {
    const api = createOfficialApiClient({ maxRequests });
    // Enforced by PostgreSQL, even if preview logic changes in the future.
    await client.query('BEGIN READ ONLY');
    let preview;
    try {
      preview = await previewLinkRecovery(client, { limit, resolve: createHistoricalLinkResolver({ api }) });
    } finally { await client.query('ROLLBACK'); }
    const output = { version: 1, database, created_at: new Date().toISOString(), ...preview };
    await writeFile(options['--output'], JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const row of output.results) console.log(JSON.stringify(row));
    console.log(JSON.stringify({ event: 'official_links.recovery.preview', ...output.counters, requests: api.requests,
      file: options['--output'], confirmation: confirmationFor(output) }));
  }
} catch (error) {
  console.error(error.code || error.severity ? 'Falha de leitura/gravação. Nenhum envio foi realizado; confira a conexão e o arquivo.' : error.message);
  process.exitCode = 1;
} finally { await client?.end(); }
