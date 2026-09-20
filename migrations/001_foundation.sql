CREATE TABLE empresas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  razao_social text NOT NULL CHECK (length(trim(razao_social)) > 0),
  nome_fantasia text,
  cnpj varchar(14) NOT NULL UNIQUE CHECK (cnpj ~ '^[0-9]{14}$'),
  email text NOT NULL,
  telefone text,
  cidade text,
  estado varchar(2) CHECK (estado IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'inativo')),
  plano text NOT NULL DEFAULT 'basico',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nome text NOT NULL CHECK (length(trim(nome)) > 0),
  email text NOT NULL,
  senha_hash text NOT NULL CHECK (senha_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  tipo text NOT NULL DEFAULT 'usuario' CHECK (tipo IN ('usuario', 'gestor', 'admin')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id)
);
CREATE UNIQUE INDEX usuarios_email_unique ON usuarios (lower(trim(email)));
CREATE INDEX usuarios_empresa_idx ON usuarios (empresa_id);

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER empresas_updated_at BEFORE UPDATE ON empresas
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER usuarios_updated_at BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
