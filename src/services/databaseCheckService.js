import { readMigrations } from './migrationService.js';

export const requiredTables = ['schema_migrations', 'empresas', 'usuarios', 'sessoes', 'licitacoes_pncp', 'interesses', 'matches'];

// Only SELECTs: this check never applies migrations or modifies application data.
export async function inspectDatabase(database) {
  await database.query('SELECT 1');
  const missingTables = [];
  for (const table of requiredTables) {
    const { rows } = await database.query('SELECT to_regclass($1) AS relation', [table]);
    if (!rows[0]?.relation) missingTables.push(table);
  }
  const expected = await readMigrations();
  const applied = missingTables.includes('schema_migrations') ? [] :
    (await database.query('SELECT name, checksum FROM schema_migrations')).rows;
  const known = new Map(applied.map(row => [row.name, row.checksum]));
  const pending = expected.filter(row => !known.has(row.name)).map(row => row.name);
  const changed = expected.filter(row => known.has(row.name) && known.get(row.name) !== row.checksum).map(row => row.name);
  const unknownCount = applied.filter(row => !expected.some(item => item.name === row.name)).length;
  return {
    presentTables: requiredTables.filter(table => !missingTables.includes(table)),
    missingTables, pending, changed, unknownCount, migrationCount: expected.length
  };
}

export async function checkDatabase(database) {
  const { missingTables, pending, changed, unknownCount, migrationCount } = await inspectDatabase(database);
  if (missingTables.length || pending.length || changed.length || unknownCount) {
    const error = new Error(`Schema incompatível. Tabelas ausentes: ${missingTables.join(', ') || 'nenhuma'}; migrations pendentes: ${pending.join(', ') || 'nenhuma'}; checksums alterados: ${changed.join(', ') || 'nenhum'}; migrations desconhecidas: ${unknownCount}. Verifique o pre-deploy e o banco configurado.`);
    error.code = 'DATABASE_SCHEMA_MISMATCH';
    throw error;
  }
  return { connection: 'ok', tables: requiredTables.length, migrations: migrationCount };
}
