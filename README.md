# intelecto-backend

API REST del Sistema de Ventas Intelecto (NestJS + TypeORM + PostgreSQL).

## Requisitos
Node 20 y Docker. La BD vive en `db/` (ver [db/README.md](db/README.md)).

## Desarrollo
```bash
cp .env.example .env
docker compose up -d      # postgres (localhost:5434) + pgadmin (localhost:5051)
npm install
npm run start:dev
```
- API: http://localhost:3000/api/v1
- Swagger: http://localhost:3000/api/docs
- Usuario inicial: `admin` / `Intelecto2026!`

## Con Docker
```bash
docker compose --profile api up -d --build     # BD + API en contenedores
docker compose logs -f api
```

## Scripts
| Comando | Uso |
|---|---|
| `npm run start:dev` | Desarrollo con recarga |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm test` | Pruebas unitarias |
| `npm run build` | Compilar a `dist/` |

## Reglas del proyecto
- Montos: siempre `common/utils/money.ts` (decimal.js). Nunca `number` para dinero.
- Esquema: lo manda `db/sql/`. `synchronize` está apagado.
- Permisos: `@Roles(...)` en el controlador; sin decorador = cualquier usuario autenticado; `@Public()` para rutas abiertas.
- Fase 2: rutas con `@Feature('PORTAL_CLIENTES' | 'PAGOS_LINEA' | 'FEL')` responden 404 mientras la bandera esté en `false`.
- Todo cambio de datos registra bitácora (`BitacoraService.registrar`).

## Render
Web Service → Docker → rama `main`. Health check: `/api/v1/health`.
Variables: `DATABASE_URL` (Neon), `DATABASE_SSL=true`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN` (URL de Cloudflare Pages), `NODE_ENV=production`, `FEATURE_*=false`.
