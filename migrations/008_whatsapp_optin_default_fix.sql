ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_whatsapp_optin_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_whatsapp_optin_check
  CHECK (NOT alertas_whatsapp OR whatsapp_numero='' OR (whatsapp_numero<>'' AND whatsapp_consentimento_em IS NOT NULL));
