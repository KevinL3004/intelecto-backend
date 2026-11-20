#!/bin/sh
# Al crear el volumen por primera vez, aplica en orden las migraciones V003, V004...
set -e
for f in /docker-entrypoint-initdb.d/migrations/V*.sql; do
  [ -e "$f" ] || continue
  echo "Aplicando migración $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
done
