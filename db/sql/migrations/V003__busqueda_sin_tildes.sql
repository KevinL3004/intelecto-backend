-- V003: búsqueda sin distinguir tildes ni mayúsculas ("maria" encuentra "María").
-- f_norm(texto) = minúsculas y sin tildes. IMMUTABLE para poder usarla en índices.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION f_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;
