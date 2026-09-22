ALTER TABLE usuarios ADD COLUMN whatsapp_numero text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN alertas_whatsapp boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN whatsapp_consentimento_em timestamptz;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_whatsapp_numero_check
  CHECK (whatsapp_numero='' OR whatsapp_numero ~ '^\+55[1-9][0-9]9[0-9]{8}$');
ALTER TABLE usuarios ADD CONSTRAINT usuarios_whatsapp_optin_check
  CHECK (NOT alertas_whatsapp OR (whatsapp_numero<>'' AND whatsapp_consentimento_em IS NOT NULL));

-- Existing deliveries remain email deliveries and keep their status/history.
ALTER TABLE alertas ADD COLUMN canal text NOT NULL DEFAULT 'email' CHECK (canal IN ('email','whatsapp'));
ALTER TABLE alertas ADD COLUMN provedor_mensagem_id text;
ALTER TABLE alertas DROP CONSTRAINT alertas_match_id_usuario_id_key;
ALTER TABLE alertas ADD CONSTRAINT alertas_match_usuario_canal_key UNIQUE (match_id,usuario_id,canal);
