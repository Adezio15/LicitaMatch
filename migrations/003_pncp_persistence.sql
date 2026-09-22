CREATE TABLE licitacoes_pncp (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo_externo text NOT NULL UNIQUE,
  objeto text NOT NULL CHECK (length(trim(objeto)) > 0),
  data_abertura timestamptz NOT NULL,
  unidade_gestora text NOT NULL CHECK (length(trim(unidade_gestora)) > 0),
  modalidade text NOT NULL DEFAULT 'N/D',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'pncp'
);

CREATE INDEX licitacoes_pncp_data_idx ON licitacoes_pncp (data_abertura DESC);

CREATE FUNCTION licitacoes_pncp_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER licitacoes_pncp_updated_at BEFORE UPDATE ON licitacoes_pncp
FOR EACH ROW EXECUTE FUNCTION licitacoes_pncp_set_updated_at();
