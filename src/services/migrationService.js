import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function readMigrations(directory = new URL('../../migrations/', import.meta.url)) {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function runMigrations(client, migrations) {
  await client.query('BEGIN');
  try {
    // Lock transacional, inclusive na primeira execução e entre processos.
    await client.query('SELECT pg_advisory_xact_lock(742193810)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const known = new Map(rows.map(row => [row.name, row.checksum]));
    const available = new Set(migrations.map(migration => migration.name));
    for (const name of known.keys()) {
      if (!available.has(name)) throw new Error('Migration aplicada ausente no projeto');
    }
    const applied = [];
    for (const migration of migrations) {
      if (known.has(migration.name)) {
        if (known.get(migration.name) !== migration.checksum) throw new Error(`Migration já aplicada foi alterada: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
