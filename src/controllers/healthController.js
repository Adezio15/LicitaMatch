export function healthController(database, logger) {
  return {
    live(_req, res) { res.json({ status: 'ok', service: 'licitamatch' }); },
    async ready(_req, res) {
      try {
        await database.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
      } catch (error) {
        logger.warn({ code: error.code }, 'Banco indisponível no readiness');
        res.status(503).json({ status: 'unavailable' });
      }
    }
  };
}
