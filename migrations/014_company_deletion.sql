-- Preserve references and trial history when an administrator removes a company.
ALTER TABLE empresas ADD COLUMN excluida_em timestamptz;
