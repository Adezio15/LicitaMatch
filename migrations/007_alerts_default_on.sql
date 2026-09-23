ALTER TABLE usuarios
  ALTER COLUMN alertas_email SET DEFAULT true,
  ALTER COLUMN alertas_whatsapp SET DEFAULT true;

UPDATE usuarios
SET alertas_email = true
WHERE alertas_email IS DISTINCT FROM true;

UPDATE usuarios
SET alertas_whatsapp = true
WHERE alertas_whatsapp IS DISTINCT FROM true;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_whatsapp_optin_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_whatsapp_optin_check
  CHECK (NOT alertas_whatsapp OR whatsapp_numero='' OR (whatsapp_numero<>'' AND whatsapp_consentimento_em IS NOT NULL));
