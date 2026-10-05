CREATE TABLE alertas_empresa_email (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id bigint NOT NULL REFERENCES empresas(id),
  licitacao_id bigint NOT NULL REFERENCES licitacoes_pncp(id),
  match_id bigint NOT NULL REFERENCES matches(id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviando','enviado','falhou')),
  enviado_em timestamptz,
  provedor_mensagem_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id,licitacao_id)
);

-- Preserve deliveries made by any user or interest before switching to company email.
INSERT INTO alertas_empresa_email (empresa_id,licitacao_id,match_id,status,enviado_em,provedor_mensagem_id)
SELECT DISTINCT ON (m.empresa_id,m.licitacao_id)
  m.empresa_id,m.licitacao_id,m.id,'enviado',a.enviado_em,a.provedor_mensagem_id
FROM alertas a JOIN matches m ON m.id=a.match_id
WHERE a.canal='email' AND a.status='enviado'
ORDER BY m.empresa_id,m.licitacao_id,a.enviado_em DESC NULLS LAST,a.id DESC;

CREATE INDEX alertas_empresa_email_pendentes_idx ON alertas_empresa_email(id) WHERE status='pendente';
