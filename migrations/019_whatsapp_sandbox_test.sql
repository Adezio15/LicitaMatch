-- A single durable reservation for this controlled test, including uncertain attempts.
CREATE TABLE whatsapp_sandbox_test (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  confirmation text NOT NULL,
  alerta_id bigint NOT NULL REFERENCES alertas_empresa_whatsapp(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
