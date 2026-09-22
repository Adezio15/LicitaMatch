import pg from 'pg';
import { loadEnvironment, postgresUrl } from '../src/config/env.js';
import { AdminSeedError, parseAdminSeed, createAdmin } from '../src/services/adminSeedService.js';

let client;
try {
  loadEnvironment();
  const options = parseAdminSeed(process.env, process.argv.slice(2));
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!postgresUrl.safeParse(connectionString).success) {
    throw new AdminSeedError('Configure DATABASE_DIRECT_URL ou DATABASE_URL com uma URL PostgreSQL válida.');
  }
  client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000,
    statement_timeout: 15000, application_name: 'licitamatch-admin-create' });
  client.on('error', () => {
    console.error('Conexão administrativa interrompida.');
    process.exitCode = 1;
  });
  await client.connect();
  const status = await createAdmin(client, options);
  console.log({ created: 'Administrador criado.', exists: 'Administrador já existe; senha preservada. Use --update-password para alterá-la.',
    updated: 'Senha do administrador atualizada; sessões anteriores invalidadas.' }[status]);
} catch (error) {
  console.error(error instanceof AdminSeedError ? error.message : 'Falha ao cadastrar administrador. Verifique conexão, migrations e unicidade do e-mail.');
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.end(); }
    catch { console.error('Falha ao encerrar conexão administrativa.'); process.exitCode = 1; }
  }
}
