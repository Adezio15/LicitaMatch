-- Perfil independente dos interesses e do cálculo atual de match.
CREATE TABLE empresa_perfil (
  empresa_id bigint PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  atendimento_nacional boolean NOT NULL DEFAULT false,
  capacidade_quantidade numeric(18,3) CHECK (capacidade_quantidade > 0),
  capacidade_unidade text NOT NULL DEFAULT '',
  capacidade_periodo text NOT NULL DEFAULT '' CHECK (capacidade_periodo IN ('','dia','mes','pedido','outro')),
  capacidade_descricao text NOT NULL DEFAULT '',
  oportunidade_min numeric(18,2) CHECK (oportunidade_min >= 0),
  oportunidade_max numeric(18,2) CHECK (oportunidade_max >= 0),
  margem_min numeric(5,2) CHECK (margem_min BETWEEN 0 AND 100),
  entrega_quantidade integer CHECK (entrega_quantidade > 0),
  entrega_unidade text NOT NULL DEFAULT '' CHECK (entrega_unidade IN ('','dias_uteis','dias_corridos')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (oportunidade_max IS NULL OR oportunidade_min IS NULL OR oportunidade_max >= oportunidade_min),
  CHECK ((entrega_quantidade IS NULL AND entrega_unidade = '') OR (entrega_quantidade IS NOT NULL AND entrega_unidade <> ''))
);
CREATE TRIGGER empresa_perfil_updated_at BEFORE UPDATE ON empresa_perfil FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE empresa_atividades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('principal','secundario','efetiva')),
  cnae varchar(7) CHECK (cnae IS NULL OR cnae ~ '^[0-9]{7}$'),
  descricao text NOT NULL CHECK (length(trim(descricao)) > 0),
  CHECK (tipo = 'efetiva' OR cnae IS NOT NULL)
);
CREATE INDEX empresa_atividades_empresa_idx ON empresa_atividades(empresa_id);
CREATE UNIQUE INDEX empresa_cnae_principal_unique ON empresa_atividades(empresa_id) WHERE tipo='principal';
CREATE UNIQUE INDEX empresa_cnae_unique ON empresa_atividades(empresa_id,cnae) WHERE tipo <> 'efetiva';

CREATE TABLE empresa_produtos_servicos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('produto','servico')),
  nome text NOT NULL CHECK (length(trim(nome)) > 0),
  descricao text NOT NULL DEFAULT '',
  categoria text NOT NULL DEFAULT '',
  palavras_chave text[] NOT NULL DEFAULT '{}',
  especificacoes text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT '',
  capacidade text NOT NULL DEFAULT ''
);
CREATE INDEX empresa_produtos_servicos_empresa_idx ON empresa_produtos_servicos(empresa_id);

CREATE TABLE empresa_marcas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  marca text NOT NULL DEFAULT '',
  fabricante text NOT NULL DEFAULT '',
  marcas_equivalentes text[] NOT NULL DEFAULT '{}',
  produtos_equivalentes text NOT NULL DEFAULT '',
  CHECK (length(trim(marca)) > 0 OR length(trim(fabricante)) > 0 OR length(trim(produtos_equivalentes)) > 0 OR cardinality(marcas_equivalentes) > 0)
);
CREATE INDEX empresa_marcas_empresa_idx ON empresa_marcas(empresa_id);

CREATE TABLE empresa_regioes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('estado','regiao','municipio')),
  estado varchar(2) CHECK (estado IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  nome text NOT NULL DEFAULT '',
  CHECK ((tipo='estado' AND estado IS NOT NULL) OR (tipo='municipio' AND estado IS NOT NULL AND length(trim(nome))>0) OR (tipo='regiao' AND estado IS NULL AND nome IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul')))
);
CREATE INDEX empresa_regioes_empresa_idx ON empresa_regioes(empresa_id);

-- Somente metadados. Nenhuma URL pública ou arquivo improvisado.
CREATE TABLE empresa_documentos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (length(trim(tipo)) > 0),
  observacao text NOT NULL DEFAULT ''
);
CREATE INDEX empresa_documentos_empresa_idx ON empresa_documentos(empresa_id);

CREATE TABLE empresa_certificacoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) > 0),
  numero text NOT NULL DEFAULT '',
  orgao_emissor text NOT NULL DEFAULT '',
  validade date,
  observacao text NOT NULL DEFAULT ''
);
CREATE INDEX empresa_certificacoes_empresa_idx ON empresa_certificacoes(empresa_id);

CREATE TABLE empresa_restricoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('regiao','quantidade_minima','prazo','produto','modalidade','outra')),
  descricao text NOT NULL CHECK (length(trim(descricao)) > 0)
);
CREATE INDEX empresa_restricoes_empresa_idx ON empresa_restricoes(empresa_id);
