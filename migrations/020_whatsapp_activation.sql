-- No production switch is enabled by this migration. The first production worker
-- invocation establishes a durable cutoff, excluding all pre-existing matches.
CREATE TABLE whatsapp_ativacao_producao (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativado_em timestamptz NOT NULL
);
ALTER TABLE usuarios ADD COLUMN whatsapp_habilitado_em timestamptz;

CREATE FUNCTION whatsapp_usuario_configurado(u usuarios) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(u.ativo AND u.tipo IN ('gestor','admin') AND u.alertas_whatsapp
   AND u.whatsapp_consentimento_em IS NOT NULL AND u.whatsapp_numero<>'', false);
$$;

CREATE FUNCTION whatsapp_marco_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE empresa empresas;
BEGIN
  SELECT * INTO empresa FROM empresas WHERE id=NEW.empresa_id;
  IF NOT whatsapp_usuario_configurado(NEW) OR empresa.status<>'ativo'
     OR plano_efetivo(empresa)<>'premium' THEN
    NEW.whatsapp_habilitado_em := NULL;
  ELSIF TG_OP='INSERT' THEN
    NEW.whatsapp_habilitado_em := clock_timestamp();
  ELSIF NOT whatsapp_usuario_configurado(OLD)
     OR NEW.whatsapp_numero IS DISTINCT FROM OLD.whatsapp_numero
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.whatsapp_habilitado_em IS NULL THEN
    NEW.whatsapp_habilitado_em := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER whatsapp_marco_usuario BEFORE INSERT OR UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION whatsapp_marco_usuario();

CREATE FUNCTION whatsapp_marco_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE antes boolean; depois boolean;
BEGIN
  antes := OLD.status='ativo' AND plano_efetivo(OLD)='premium';
  depois := NEW.status='ativo' AND plano_efetivo(NEW)='premium';
  -- Covers upgrade/downgrade, suspension, restoration and trial renewal after expiry.
  IF antes IS DISTINCT FROM depois THEN
    UPDATE usuarios SET whatsapp_habilitado_em=CASE
      WHEN depois AND whatsapp_usuario_configurado(usuarios) THEN clock_timestamp()
      ELSE NULL END WHERE empresa_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER whatsapp_marco_empresa AFTER UPDATE ON empresas
FOR EACH ROW EXECUTE FUNCTION whatsapp_marco_empresa();

-- Existing opted-in recipients start here, never at their historical consent date.
UPDATE usuarios SET whatsapp_habilitado_em=NULL;
CREATE INDEX matches_whatsapp_created_idx ON matches (empresa_id,created_at,id);
