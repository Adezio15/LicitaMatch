import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

export const SESSION_COOKIE = 'licitamatch.sid';
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const REMEMBER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function cookieOptions(config) {
  return { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

export function createSession({ config, database, logger }) {
  const Store = connectPgSimple(session);
  const store = new Store({
    pool: database, tableName: 'sessoes', createTableIfMissing: false,
    ttl: SESSION_LIFETIME_MS / 1000, disableTouch: true,
    pruneSessionInterval: config.NODE_ENV === 'test' ? false : 900,
    errorLog: () => logger.error('Falha no armazenamento de sessões')
  });
  return { store, middleware: session({
    name: SESSION_COOKIE, secret: config.SESSION_SECRET, store,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: cookieOptions(config)
  }) };
}
