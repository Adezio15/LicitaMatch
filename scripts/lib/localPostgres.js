import { readFile, writeFile, mkdir, unlink, access, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { readMigrations, runMigrations } from '../../src/services/migrationService.js';

const execFileAsync = promisify(execFile);
export const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, '.local', 'postgres');
const dataDirectory = join(directory, 'data');
const credentialsPath = join(directory, 'credentials.json');
const envPath = join(root, '.env');
const host = '127.0.0.1';
const port = 55432;
const databaseName = 'licitamatch_dev';
const adminUser = 'licitamatch_admin';
const appUser = 'licitamatch_app';
let nativeRootPromise;

async function nativeRoot() {
  if (process.platform !== 'win32') return root;
  // Binários PostgreSQL para Windows usam ANSI em alguns caminhos internos.
  // O alias 8.3 evita corrupção de nomes como "Usuário", sem mover os dados.
  nativeRootPromise ||= execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:LICITAMATCH_LOCAL_ROOT).ShortPath'],
  { windowsHide: true, timeout: 10000, env: { ...process.env, LICITAMATCH_LOCAL_ROOT: root } })
    .then(result => result.stdout.trim());
  const path = await nativeRootPromise;
  if (!path || /[^\x00-\x7F]/.test(path)) throw new Error('O PostgreSQL local precisa de um caminho Windows sem acentos ou de um alias curto 8.3 disponível.');
  return path;
}

async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function localEnvironment() {
  const content = await readFile(envPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  return { content, values: { ...dotenv.parse(content), ...process.env } };
}

export function assertLocalTarget(values) {
  if (values.NODE_ENV && values.NODE_ENV !== 'development') throw new Error('O banco local só pode ser gerenciado em NODE_ENV=development.');
  if (values.DATABASE_URL) {
    const url = new URL(values.DATABASE_URL);
    const example = url.hostname === 'localhost' && url.port === '5432' && url.pathname === '/licitamatch' && url.username === 'postgres' && url.password === 'CHANGE_ME';
    const managed = url.hostname === host && url.port === String(port) && url.pathname === `/${databaseName}` && url.username === appUser;
    if (!example && !managed) {
      throw new Error('DATABASE_URL aponta para outro banco. A configuração existente não será substituída.');
    }
  }
  if (values.DATABASE_DIRECT_URL && values.DATABASE_DIRECT_URL !== values.DATABASE_URL) {
    throw new Error('DATABASE_DIRECT_URL aponta para outro banco. Revise o .env antes de configurar o banco local.');
  }
}

async function binaries() {
  const require = createRequire(import.meta.url);
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const entry = require.resolve(`@embedded-postgres/${platform}-${process.arch}`, {
    paths: [dirname(require.resolve('embedded-postgres'))]
  });
  return import(pathToFileURL(entry).href);
}

async function runBinary(binary, args) {
  const cwd = await nativeRoot();
  const nativePath = value => value.replaceAll(root.replace(/[\\/]$/, ''), cwd.replace(/[\\/]$/, ''));
  if (args.at(-1) === 'start') {
    // PostgreSQL continua após pg_ctl. Arquivo evita pipes herdados manterem
    // o comando npm pendurado até o timeout no Windows.
    const output = await open(join(directory, 'control.log'), 'a');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(nativePath(binary), args.map(nativePath), {
          cwd, windowsHide: true, stdio: ['ignore', output.fd, output.fd]
        });
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Timeout ao iniciar PostgreSQL. Consulte .local/postgres/control.log.'));
        }, 45000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error('Não foi possível iniciar PostgreSQL. Consulte .local/postgres/control.log.'));
        });
      });
      return;
    } finally { await output.close(); }
  }
  try {
    return await execFileAsync(nativePath(binary), args.map(nativePath), { cwd, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    // Argumentos não contêm senhas. Mantém o diagnóstico nativo sem expor URLs.
    const failure = new Error(`PostgreSQL local: ${String(error.stderr || error.stdout || error.code).trim()}`);
    failure.exitCode = error.code;
    throw failure;
  }
}

async function credentials(create = false) {
  if (await exists(credentialsPath)) return JSON.parse(await readFile(credentialsPath, 'utf8'));
  if (!create) throw new Error('Banco local ainda não configurado. Execute npm.cmd run db:local:setup.');
  if (await exists(join(dataDirectory, 'PG_VERSION'))) throw new Error('O banco já contém dados, mas o arquivo de credenciais está ausente. Nenhum dado foi alterado.');
  await mkdir(directory, { recursive: true });
  const value = { adminPassword: randomBytes(32).toString('hex'), appPassword: randomBytes(32).toString('hex') };
  await writeFile(credentialsPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  return value;
}

function appUrl(secrets) {
  const url = new URL(`postgresql://${appUser}@${host}:${port}/${databaseName}`);
  url.password = secrets.appPassword;
  url.searchParams.set('sslmode', 'disable');
  return url.href;
}

async function isRunning(bin) {
  if (!await exists(join(dataDirectory, 'PG_VERSION'))) return false;
  try { await runBinary(bin.pg_ctl, ['-D', dataDirectory, 'status']); return true; }
  catch (error) { if (error.exitCode === 3) return false; throw error; }
}

async function saveEnvironment(secrets) {
  const { content } = await localEnvironment();
  const current = dotenv.parse(content);
  const values = {
    NODE_ENV: 'development', LOCAL_DATABASE: 'true', DATABASE_URL: appUrl(secrets), DATABASE_DIRECT_URL: appUrl(secrets)
  };
  if (!current.SESSION_SECRET || /SUBSTITUA|CHANGE_ME/.test(current.SESSION_SECRET)) values.SESSION_SECRET = randomBytes(48).toString('hex');
  let next = content || await readFile(join(root, '.env.example'), 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}=.*$`, 'm');
    next = expression.test(next) ? next.replace(expression, `${key}=${value}`) : `${next.trimEnd()}\n${key}=${value}\n`;
  }
  await writeFile(envPath, next, { mode: 0o600 });
}

export async function setupLocalDatabase(logger) {
  const { values } = await localEnvironment();
  assertLocalTarget(values);
  const secrets = await credentials(true);
  const bin = await binaries();
  if (!await exists(join(dataDirectory, 'PG_VERSION'))) {
    logger.info('Inicializando PostgreSQL local. Os dados serão preservados entre execuções.');
    const passwordFile = join(directory, 'init-password');
    await writeFile(passwordFile, secrets.adminPassword, { mode: 0o600 });
    try {
      await runBinary(bin.initdb, ['-D', dataDirectory, '-U', adminUser, `--pwfile=${passwordFile}`,
        '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally { await unlink(passwordFile); }
  }
  if (!await isRunning(bin)) {
    // Conf separado, sem alterar configs existentes do PostgreSQL.
    await writeFile(join(dataDirectory, 'postgresql.auto.conf'), [
      "listen_addresses = '127.0.0.1'", `port = ${port}`, "timezone = 'UTC'", "log_timezone = 'UTC'",
      "password_encryption = 'scram-sha-256'", 'max_connections = 30', "shared_buffers = '64MB'", ''
    ].join('\n'));
    await runBinary(bin.pg_ctl, ['-D', dataDirectory, '-l', join(directory, 'postgres.log'), '-w', '-t', '30', 'start']);
  }
  const admin = new pg.Client({ host, port, user: adminUser, password: secrets.adminPassword, database: 'postgres', connectionTimeoutMillis: 10000 });
  try {
    await admin.connect();
    const roles = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [appUser]);
    if (!roles.rowCount) await admin.query(`CREATE ROLE ${pg.escapeIdentifier(appUser)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(secrets.appPassword)}`);
    const databases = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
    if (!databases.rowCount) await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)} OWNER ${pg.escapeIdentifier(appUser)}`);
  } finally { await admin.end(); }
  const client = new pg.Client({ connectionString: appUrl(secrets), options: '-c timezone=UTC', connectionTimeoutMillis: 10000 });
  let applied;
  try {
    await client.connect();
    applied = await runMigrations(client, await readMigrations());
  } finally { await client.end(); }
  await saveEnvironment(secrets);
  logger.info({ host, port, database: databaseName, applied }, 'PostgreSQL local pronto; .env configurado.');
}

export async function stopLocalDatabase(logger) {
  const { values } = await localEnvironment();
  assertLocalTarget(values);
  const bin = await binaries();
  if (await isRunning(bin)) await runBinary(bin.pg_ctl, ['-D', dataDirectory, '-m', 'fast', '-w', '-t', '30', 'stop']);
  logger.info('PostgreSQL local parado. Dados preservados.');
}

export async function localDatabaseStatus(logger) {
  const bin = await binaries();
  const running = await isRunning(bin);
  logger.info({ running, host, port, database: databaseName }, running ? 'PostgreSQL local em execução.' : 'PostgreSQL local parado.');
  return running;
}
