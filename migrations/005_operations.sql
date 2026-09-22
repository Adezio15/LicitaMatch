ALTER TABLE usuarios ADD COLUMN alertas_email boolean NOT NULL DEFAULT false;
CREATE INDEX interesses_empresa_idx ON interesses (empresa_id, ativo);
CREATE INDEX matches_empresa_idx ON matches (empresa_id, score DESC, id DESC);

-- Existing opportunities are preserved. Fingerprints are populated on new imports.
ALTER TABLE licitacoes_pncp ADD COLUMN assinatura text;
CREATE UNIQUE INDEX licitacoes_assinatura_idx ON licitacoes_pncp (assinatura) WHERE assinatura IS NOT NULL;

CREATE TABLE tarefas (
  nome text PRIMARY KEY,
  proxima_execucao timestamptz NOT NULL DEFAULT now(),
  ultima_execucao timestamptz,
  ultimo_sucesso timestamptz,
  estado text NOT NULL DEFAULT 'aguardando',
  cursor jsonb NOT NULL DEFAULT '{}',
  resumo jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE alertas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES matches(id),
  usuario_id bigint NOT NULL REFERENCES usuarios(id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','falhou')),
  tentativas integer NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id,usuario_id)
);
CREATE INDEX alertas_pendentes_idx ON alertas (proxima_tentativa) WHERE status='pendente';
