# db — Base de datos

PostgreSQL 16 del Sistema de Ventas Intelecto (SVI). Vive dentro del repo del backend; el `docker-compose.yml` está en la raíz del backend.

## Local (Docker) — desde la raíz de `intelecto-backend`
```bash
cp .env.example .env
docker compose up -d
docker compose ps          # postgres debe estar "healthy"
```
- PostgreSQL: `localhost:5434` · BD `intelecto` · usuario `intelecto` · clave `intelecto_dev`
- pgAdmin: http://localhost:5051 (admin@intelecto.com / admin). Host del servidor dentro de pgAdmin: `postgres`, puerto `5432`.

Los scripts de `db/sql/` solo se ejecutan la **primera vez** (volumen vacío). Para reiniciar desde cero:
```bash
docker compose down -v && docker compose up -d
```

Usuario inicial del sistema: `admin` / `Intelecto2026!` (pide cambiar la contraseña).

## Neon (producción)
```bash
brew install libpq && brew link --force libpq   # si no tienes psql
export DATABASE_URL="postgresql://USUARIO:CLAVE@HOST.neon.tech/intelecto?sslmode=require"
psql "$DATABASE_URL" -f db/sql/01_schema.sql
psql "$DATABASE_URL" -f db/sql/02_seed.sql
```

## Migraciones
Nunca editar `01_schema.sql` después de producción. Cada cambio nuevo va en `db/sql/migrations/V003__descripcion.sql` y se aplica en local y en Neon.

## Respaldo
```bash
pg_dump "$DATABASE_URL" -Fc -f respaldo_$(date +%Y%m%d).dump
```
