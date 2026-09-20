ALTER TABLE usuarios ADD COLUMN auth_version integer NOT NULL DEFAULT 1;

CREATE TABLE sessoes (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamptz NOT NULL
);
CREATE INDEX sessoes_expire_idx ON sessoes (expire);
