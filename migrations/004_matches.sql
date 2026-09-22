CREATE TABLE interesses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL,
  titulo text NOT NULL CHECK (length(trim(titulo)) > 0),
  palavras text[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  interesse_id bigint NOT NULL,
  licitacao_id bigint NOT NULL,
  empresa_id bigint NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'revisado', 'aceito', 'recusado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interesse_id, licitacao_id)
);

CREATE INDEX matches_interesse_idx ON matches (interesse_id, score DESC);
CREATE INDEX matches_licitacao_idx ON matches (licitacao_id, score DESC);

CREATE FUNCTION matches_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER interesses_updated_at BEFORE UPDATE ON interesses
FOR EACH ROW EXECUTE FUNCTION matches_set_updated_at();

CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches
FOR EACH ROW EXECUTE FUNCTION matches_set_updated_at();
