-- Additive only. No activation, provider calls or historical notifications.
CREATE TABLE whatsapp_controle (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 suspenso boolean NOT NULL DEFAULT false
);
INSERT INTO whatsapp_controle (id) VALUES (true);
ALTER TABLE alertas_empresa_whatsapp ADD COLUMN limite_diario integer NOT NULL DEFAULT 10 CHECK (limite_diario>=0);
ALTER TABLE alertas_empresa_whatsapp ADD COLUMN custo_estimado_brl numeric(12,6) CHECK (custo_estimado_brl>=0);
CREATE INDEX whatsapp_alertas_usuario_data_idx ON alertas_empresa_whatsapp(usuario_id,created_at);
CREATE FUNCTION whatsapp_reserva_notificacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Serialize reservations for a recipient, including different opportunities.
 PERFORM id FROM usuarios WHERE id=NEW.usuario_id FOR UPDATE;
 IF COALESCE((SELECT suspenso FROM whatsapp_controle WHERE id=true),true)
    OR EXISTS (SELECT 1 FROM alertas_empresa_whatsapp WHERE usuario_id=NEW.usuario_id AND licitacao_id=NEW.licitacao_id)
    OR (SELECT count(*) FROM alertas_empresa_whatsapp WHERE usuario_id=NEW.usuario_id
        AND created_at>clock_timestamp()-interval '24 hours') >= NEW.limite_diario THEN
   RETURN NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER whatsapp_reserva_notificacao BEFORE INSERT ON alertas_empresa_whatsapp
 FOR EACH ROW EXECUTE FUNCTION whatsapp_reserva_notificacao();
-- Independent events survive callbacks arriving before provider SID persistence.
CREATE TABLE whatsapp_status_eventos (
 mensagem_id text NOT NULL CHECK (mensagem_id ~ '^SM[0-9a-fA-F]{32}$'),
 estado text NOT NULL CHECK (estado IN ('accepted','queued','sending','sent','delivered','read','failed','undelivered')),
 erro_codigo integer,
 recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (mensagem_id,estado)
);
