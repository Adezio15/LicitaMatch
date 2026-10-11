-- Supported modalities are available in every UF, including delivery queues.
CREATE FUNCTION modalidade_oportunidade(modalidade text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(translate(lower(trim(modalidade)), 'ãôóéêçáàâíú', 'aooeecaaaiu'), '[^a-z]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION licitacao_permitida(modalidade text, uf text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(modalidade_oportunidade(modalidade) IN
    ('pregao eletronico', 'pregao presencial', 'dispensa', 'dispensa de licitacao'), false);
$$;
