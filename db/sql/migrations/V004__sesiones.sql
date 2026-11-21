-- V004: sesiones revocables con rotación de refresh token y detección de reúso.
-- El refresh token es opaco ("<id_sesion>.<secreto aleatorio>"); aquí solo se guarda el SHA-256 del secreto.
CREATE TABLE sesion (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id         BIGINT NOT NULL REFERENCES usuario(id),
  refresh_hash       CHAR(64) NOT NULL,                 -- sha256 hex del refresh vigente
  ip                 VARCHAR(45),
  user_agent         VARCHAR(200),
  creada_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en          TIMESTAMPTZ NOT NULL,              -- vida máxima absoluta
  revocada_en        TIMESTAMPTZ,
  motivo_revocacion  VARCHAR(40)                        -- LOGOUT, REUSO, CAMBIO_PASSWORD, ...
);
CREATE INDEX ix_sesion_usuario_activa ON sesion (usuario_id) WHERE revocada_en IS NULL;
CREATE INDEX ix_sesion_expira ON sesion (expira_en);
