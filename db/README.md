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

Usuario inicial: `admin` **sin contraseña utilizable**. Asignarla con `npm run usuario:password -- admin` (o cargar los datos de prueba en local).

## Datos de prueba (solo local)
Colegios, libros, precios, combos, inventario, cajas, clientes y un usuario por rol
(contraseña de todos: `Prueba2026!`): `admin` (si no tenía), `contador`, `cajero.norte`, `cajero.sur`.
```bash
docker exec -i intelecto_postgres psql -U intelecto -d intelecto < db/sql/demo/03_datos_prueba.sql
```
Se puede ejecutar varias veces sin duplicar. **Nunca ejecutarlo en producción.**

### Historial de 60 días (para reportes, gráficas y pronósticos)
Después del anterior y de las migraciones. Agrega un tercer colegio (`cajero.central`), libros
de 3.º, combos, proveedores, 180 familias con sus hijos y unos 60 días de operación: turnos
validados (algunos con faltante), ~630 ventas por alumno con licencias, pagos con recargo,
libros agotados con pendientes, traslados y pedidos recibidos, entregas posteriores y anulaciones.
El inventario y el kárdex quedan cuadrados con las ventas.
```bash
docker exec -i intelecto_postgres psql -U intelecto -d intelecto < db/sql/demo/04_historial.sql
```
Se aplica una sola vez (queda marcado en `parametro.demo_historial`). **Nunca en producción.**

## Neon (producción)
Render aplica el esquema y las migraciones en cada despliegue (ver [DESPLIEGUE.md](../DESPLIEGUE.md)).
A mano, desde su computadora:
```bash
DATABASE_URL='<neon>' DATABASE_SSL=true npm run db:migrar -- --ver   # qué falta
DATABASE_URL='<neon>' DATABASE_SSL=true npm run db:migrar            # aplicarlo
DATABASE_SSL=true npm run usuario:password -- admin                    # contraseña del primer admin
```
`db:migrar` lleva registro (`migracion_aplicada`), aplica cada archivo en una transacción, se
detiene si una migración aplicada fue modificada y **nunca** aplica `demo/`. En una base creada a
mano antes de existir el script: `npm run db:migrar -- --registrar-existentes` (una sola vez).

## Migraciones
Nunca editar `01_schema.sql` ni una migración ya aplicada. Cada cambio nuevo va en `db/sql/migrations/V00N__descripcion.sql` (siguiente número libre). En un volumen nuevo de Docker se aplican solas; en Neon, en cada despliegue de Render; en su base local existente, con `npm run db:migrar` o a mano:
```bash
docker exec -i intelecto_postgres psql -U intelecto -d intelecto < db/sql/migrations/V005__alumnos_licencias_correo.sql
```

| Migración | Qué agrega |
|---|---|
| V003 | Búsquedas sin tildes (`unaccent`, `f_norm`) |
| V004 | Sesiones revocables con rotación de refresh token |
| V005 | Alumnos y encargados, ventas por alumno con licencia digital, bandeja de correo y datos del comprobante |

## Respaldo
```bash
pg_dump "$DATABASE_URL" -Fc -f respaldo_$(date +%Y%m%d).dump
```
