ALTER TABLE licitacoes_pncp ADD COLUMN uf text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');

-- One rule for listings, counters, correlation and both delivery queues.
-- Unknown modalities and presencial without a confirmed UF are excluded.
CREATE FUNCTION licitacao_permitida(modalidade text, uf text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    regexp_replace(translate(lower(trim(modalidade)), 'ãôóéê', 'aooee'), '[^a-z]+', ' ', 'g') = 'pregao eletronico'
    OR (regexp_replace(translate(lower(trim(modalidade)), 'ãôóéê', 'aooee'), '[^a-z]+', ' ', 'g') = 'pregao presencial'
      AND upper(trim(uf)) IN ('RN', 'PB')), false);
$$;

-- Keep fingerprints separate across states, without rewriting existing records.
DROP INDEX licitacoes_assinatura_idx;
CREATE UNIQUE INDEX licitacoes_assinatura_idx ON licitacoes_pncp (assinatura, COALESCE(uf, '')) WHERE assinatura IS NOT NULL;
