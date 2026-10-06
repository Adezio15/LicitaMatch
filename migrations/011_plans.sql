ALTER TABLE empresas ALTER COLUMN plano SET DEFAULT 'start';
UPDATE empresas SET plano = lower(trim(plano));
UPDATE empresas SET plano = 'start' WHERE plano = 'basico';
ALTER TABLE empresas ADD CONSTRAINT empresas_plano_check CHECK (plano IN ('start','pro','premium'));
