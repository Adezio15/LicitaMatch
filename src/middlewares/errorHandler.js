import { HttpError } from '../utils/httpError.js';

export function errorHandler(logger) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.code === '23505' ? 409 :
      (error instanceof HttpError && error.status >= 400 && error.status < 500 ? error.status :
        [400, 413, 415].includes(error.status) ? error.status : 500);
    const message = error.code === '23505' ? 'Não foi possível salvar. Verifique se o e-mail ou CNPJ já está cadastrado.' :
      error instanceof HttpError ? error.message : status === 500 ? 'Erro interno do servidor' : 'Requisição inválida';
    logger[status >= 500 ? 'error' : 'warn']({ requestId: req.id, status, code: error.code }, 'Falha na requisição');
    if (!req.path.startsWith('/api/') && req.accepts(['json', 'html']) === 'html') {
      return res.status(status).render('error', { title: 'Não foi possível concluir', message, status });
    }
    res.status(status).json({ error: message, requestId: req.id });
  };
}
