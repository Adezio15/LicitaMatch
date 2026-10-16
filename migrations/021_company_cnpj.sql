ALTER TABLE empresas DROP CONSTRAINT empresas_cnpj_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_cnpj_check CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$');
ALTER TABLE empresas ADD COLUMN situacao_cadastral text NOT NULL DEFAULT '';
ALTER TABLE empresas ADD COLUMN logradouro text NOT NULL DEFAULT '';
ALTER TABLE empresas ADD COLUMN numero text NOT NULL DEFAULT '';
ALTER TABLE empresas ADD COLUMN complemento text NOT NULL DEFAULT '';
ALTER TABLE empresas ADD COLUMN bairro text NOT NULL DEFAULT '';
ALTER TABLE empresas ADD COLUMN cep text NOT NULL DEFAULT '';
