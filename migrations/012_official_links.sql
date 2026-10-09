ALTER TABLE licitacoes_pncp ADD COLUMN url_fonte text;
ALTER TABLE licitacoes_pncp ADD COLUMN cidade text;
ALTER TABLE licitacoes_pncp ADD CONSTRAINT licitacoes_url_fonte_check
  CHECK (url_fonte IS NULL OR (length(url_fonte) <= 4096 AND url_fonte ~* '^https?://[^[:space:]]+$'));
CREATE INDEX matches_empresa_created_idx ON matches (empresa_id, created_at, id);
CREATE INDEX alertas_empresa_email_enviado_idx ON alertas_empresa_email (empresa_id, enviado_em) WHERE status='enviado';
