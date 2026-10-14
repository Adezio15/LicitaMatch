-- Independent ledger preserves all existing email and WhatsApp history.
CREATE TABLE whatsapp_inbound (
  mensagem_id text PRIMARY KEY,
  numero text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_inbound_numero_idx ON whatsapp_inbound(numero,recebido_em DESC);
CREATE TABLE alertas_empresa_whatsapp (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id),
  licitacao_id bigint NOT NULL REFERENCES licitacoes_pncp(id),
  usuario_id bigint NOT NULL REFERENCES usuarios(id),
  numero text NOT NULL,
  status text NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando','enviado','falhou','incerto')),
  provedor_mensagem_id text,
  erro_codigo integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  UNIQUE (empresa_id,licitacao_id,numero)
);
-- Existing attempts must not be resent when switching providers.
INSERT INTO alertas_empresa_whatsapp (empresa_id,licitacao_id,usuario_id,numero,status,provedor_mensagem_id)
SELECT DISTINCT ON (m.empresa_id,m.licitacao_id,u.whatsapp_numero)
 m.empresa_id,m.licitacao_id,u.id,u.whatsapp_numero,
 CASE WHEN a.status='enviado' THEN 'enviado' ELSE 'incerto' END,a.provedor_mensagem_id
FROM alertas a JOIN matches m ON m.id=a.match_id JOIN usuarios u ON u.id=a.usuario_id
WHERE a.canal='whatsapp' AND (a.status<>'pendente' OR a.tentativas>0) AND u.whatsapp_numero<>''
ORDER BY m.empresa_id,m.licitacao_id,u.whatsapp_numero,a.enviado_em DESC NULLS LAST,a.id
ON CONFLICT DO NOTHING;
