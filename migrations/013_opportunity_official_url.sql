-- URLs are supplied by the source; existing records stay null until reimported.
ALTER TABLE licitacoes_pncp ADD COLUMN link_edital text;
ALTER TABLE licitacoes_pncp ADD CONSTRAINT licitacoes_link_edital_http
  CHECK (link_edital IS NULL OR (length(link_edital) <= 4096 AND link_edital ~* '^https?://[^[:space:]]+$'));
