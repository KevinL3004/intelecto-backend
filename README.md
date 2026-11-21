# intelecto-backend

API REST del Sistema de Ventas Intelecto (NestJS + TypeORM + PostgreSQL).

## Requisitos
Node 22+ (`nvm use`, ver `.nvmrc`) y Docker. La BD vive en `db/` (ver [db/README.md](db/README.md)).

## Desarrollo
```bash
cp .env.example .env
docker compose up -d      # postgres (localhost:5434) + pgadmin (localhost:5051)
npm install
npm run start:dev
```
- API: http://localhost:3000/api/v1
- Swagger: http://localhost:3000/api/docs
- Usuario inicial: `admin` **sin contraseña**. Asignarla con `npm run usuario:password -- admin`
  (la pide sin mostrarla; obliga a cambiarla al entrar). En local, `db/sql/demo/03_datos_prueba.sql`
  le asigna `Prueba2026!` si aún no tiene.

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

## Seguridad
Ver [SECURITY.md](SECURITY.md): controles implementados, cómo reportar vulnerabilidades y lista de
verificación para producción.

## Render
Web Service → Docker → rama `main`. Health check: `/api/v1/health`.
Variables: `DATABASE_URL` (Neon), `DATABASE_SSL=true`, `JWT_SECRET` (`openssl rand -hex 32`), `CORS_ORIGIN` (URL https de Cloudflare Pages), `NODE_ENV=production`, `FEATURE_*=false`. La API **no arranca** si falta algo o hay valores de ejemplo.

## Correo de comprobantes
Al cobrar, si el cliente tiene correo, el comprobante (agrupado por alumno, con su licencia) se
envía solo. Funciona con cualquier proveedor SMTP. Para activarlo, en Render:

| Variable | Ejemplo |
|---|---|
| `CORREO_HABILITADO` | `true` |
| `SMTP_HOST` / `SMTP_PORT` | `smtp-relay.brevo.com` / `587` |
| `SMTP_USUARIO` / `SMTP_PASSWORD` | credenciales SMTP del proveedor (no la contraseña de un buzón personal) |
| `CORREO_REMITENTE` | `"Intelecto <comprobantes@dominio-de-intelecto.com>"` |
| `CORREO_RESPONDER_A` | opcional, p. ej. `ventas@dominio-de-intelecto.com` |

En el DNS del dominio remitente hay que publicar los registros **SPF**, **DKIM** y **DMARC** que
indique el proveedor; sin ellos, Gmail y Outlook mandan los comprobantes a spam o los rechazan.
El estado de cada envío se ve en el detalle de la venta (Enviando / Enviado / No se pudo enviar),
y se puede reenviar a otro correo.

Datos impresos en el comprobante (dirección, teléfono, sitio de las licencias, pie): menú
**Administración → Configuración**.
