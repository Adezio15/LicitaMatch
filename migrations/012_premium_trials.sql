-- No updates to existing company plans.
ALTER TABLE empresas DROP CONSTRAINT empresas_plano_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_plano_check CHECK (plano IN ('sem_plano','start','pro','premium','premium_teste'));
ALTER TABLE empresas ALTER COLUMN plano SET DEFAULT 'sem_plano';
ALTER TABLE empresas ADD COLUMN teste_status text NOT NULL DEFAULT 'nao_solicitado' CHECK (teste_status IN ('nao_solicitado','aguardando_aprovacao','ativo','recusado','expirado')),
 ADD COLUMN teste_solicitado_em timestamptz, ADD COLUMN teste_aprovado_em timestamptz,
 ADD COLUMN teste_inicio timestamptz, ADD COLUMN teste_fim timestamptz,
 ADD COLUMN teste_utilizado_em timestamptz, ADD COLUMN teste_aprovado_por bigint REFERENCES usuarios(id);
CREATE TABLE testes_premium (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 empresa_id bigint NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE RESTRICT,
 cnpj varchar(14) NOT NULL UNIQUE,
 usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 status text NOT NULL CHECK (status IN ('aguardando_aprovacao','ativo','recusado','expirado')),
 solicitado_em timestamptz NOT NULL DEFAULT now(), aprovado_em timestamptz,
 inicio_em timestamptz, fim_em timestamptz, aprovado_por bigint REFERENCES usuarios(id),
 ip_solicitacao text, user_agent text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER testes_premium_updated_at BEFORE UPDATE ON testes_premium FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE testes_premium_tentativas (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, empresa_id bigint NOT NULL REFERENCES empresas(id),
 usuario_id bigint NOT NULL REFERENCES usuarios(id), cnpj varchar(14) NOT NULL,
 ip text, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notificacoes_plano (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, destinatario text NOT NULL, assunto text NOT NULL,
 corpo text NOT NULL, enviado_em timestamptz, tentativas integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION plano_efetivo(e empresas) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN e.plano='premium' THEN 'premium'
 WHEN e.teste_status='ativo' AND now()<e.teste_fim THEN 'premium'
 WHEN e.plano IN ('start','pro') THEN e.plano ELSE 'sem_plano' END
$$;
