# Despliegue a producción — Neon + Render + Cloudflare Pages

```
Navegador ──https──▶ Cloudflare Pages (frontend Angular, estático)
    │
    └────https──▶ Render (API NestJS, Docker) ──TLS verificado──▶ Neon (PostgreSQL)
```

Orden: **1. Neon → 2. Render → 3. Cloudflare → 4. primer administrador → 5. verificación**.
Tiempo estimado: 45 minutos. Nada de esto requiere subir secretos al repositorio.

Antes de empezar, decida los nombres (de ellos salen las URL):

| Servicio | Nombre sugerido | URL resultante |
|---|---|---|
| Render | `intelecto-backend` | `https://intelecto-backend.onrender.com` (si el nombre está tomado, Render agrega un sufijo) |
| Cloudflare Pages | `intelecto-frontend` | `https://intelecto-frontend.pages.dev` |

---

## 1. Neon (base de datos)

1. [console.neon.tech](https://console.neon.tech) → **New project**.
   - Nombre: `intelecto` · PostgreSQL **16** (la misma versión que en desarrollo).
   - Región: **AWS US East 2 (Ohio)**, la misma que Render.
   - Base de datos: `intelecto`.
2. **Connect** → copie la *connection string* (la directa, sin `-pooler`). Tiene esta forma:
   `postgresql://USUARIO:CLAVE@ep-xxxx.us-east-2.aws.neon.tech/intelecto?sslmode=require`
   Guárdela en su gestor de contraseñas: es la llave de todos los datos.
3. No ejecute nada todavía: el esquema lo crea Render en el primer despliegue (paso 2).

> **Respaldos**: el plan de Neon define cuántos días atrás puede restaurar la base. Para datos
> financieros y de menores elija un plan con al menos 7 días de restauración y, además, haga un
> respaldo propio periódico (ver "Mantenimiento").

## 2. Render (API)

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → conecte el
   repositorio `intelecto-backend`. Render lee [`render.yaml`](render.yaml) y prepara el servicio:
   Docker, región Ohio, plan Starter, health check, migraciones automáticas y despliegue solo si
   pasan las pruebas de GitHub.
2. Le pedirá dos valores:
   - `DATABASE_URL`: la connection string de Neon.
   - `CORS_ORIGIN`: `https://intelecto-frontend.pages.dev`, o su dominio propio. Solo https,
     sin `/` al final; si son varios, sepárelos con comas.
3. **Apply**. En el primer despliegue, el *pre-deploy* (`node scripts/migrar.js`) crea en Neon el
   esquema, la semilla y las migraciones. En el log verá `✓ 5 archivo(s) aplicado(s)`.
4. Cuando quede *Live*, abra `https://<su-api>.onrender.com/api/v1/health`: debe responder
   `{"status":"ok","db":"ok",…}`.

`JWT_SECRET` lo genera Render al azar. La API **se niega a arrancar** si falta una variable, si
algo trae un valor de ejemplo, si el SSL está apagado o si CORS no es https: el log lo indica.

> **Plan**: use Starter o superior. En el plan Free el servicio se duerme tras 15 minutos sin uso;
> la primera venta tardaría cerca de un minuto y los correos no salen mientras duerme.

## 3. Cloudflare Pages (frontend)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages →
   Connect to Git** → repositorio `intelecto-frontend`.
2. Configuración del build:

   | Campo | Valor |
   |---|---|
   | Project name | `intelecto-frontend` |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `npm run build:cloudflare` |
   | Build output directory | `dist/intelecto-frontend/browser` |
   | Variable `API_URL` | `https://<su-api>.onrender.com` (la URL real del paso 2) |
   | Variable `NODE_VERSION` | `22.23.5` |

   `build:cloudflare` escribe `API_URL` en la configuración de la app y en la política de
   seguridad (CSP `connect-src`), para que ambas coincidan siempre. Si la URL no es https, el
   build falla a propósito.
3. **Save and Deploy**. Si Cloudflare le asignó una URL distinta de la que puso en
   `CORS_ORIGIN`, corríjala en Render (Environment) y guarde: se redespliega solo.

## 4. Primer administrador

La semilla crea el usuario `admin` **sin contraseña utilizable**. Asígnela desde su computadora
(la contraseña se escribe oculta y no queda en el historial):

```bash
cd intelecto-backend
DATABASE_URL='<connection string de Neon>' DATABASE_SSL=true npm run usuario:password -- admin
```

Al entrar por primera vez, el sistema le pedirá cambiarla.

## 5. Verificación (antes de abrir caja)

- [ ] `https://<api>/api/v1/health` → `"db":"ok"`.
- [ ] `https://<api>/api/docs` → **404** (Swagger apagado en producción).
- [ ] `https://intelecto-frontend.pages.dev` carga; entra con `admin` y obliga a cambiar la contraseña.
- [ ] Recargar una pantalla interna (p. ej. `/ventas`) no da 404 (regla SPA de `_redirects`).
- [ ] [securityheaders.com](https://securityheaders.com) sobre el frontend → **A** o mejor.
- [ ] La consola del navegador (F12) no muestra errores de CSP ni de CORS.
- [ ] **Bitácora** (Administración): las acciones registran la IP real de quien las hizo, no una
      IP interna de Render. Esto confirma que el límite de intentos de login es por persona.
- [ ] Cargar los datos reales: colegios, cajas con su fondo, usuarios (un usuario por persona,
      nunca compartido), libros, precios del ciclo y combos. Revisar los recargos de los métodos
      de pago y los datos del comprobante en **Configuración**.
- [ ] Hacer una venta de prueba, imprimir el comprobante, anularla y cuadrar la caja.

**Nunca** cargue `db/sql/demo/*` en Neon: son datos de prueba. El script de migración no los toca
y la imagen de Docker ni siquiera los incluye.

---

## Mantenimiento

**Actualizar**: `git push` a `main`. GitHub Actions corre lint, pruebas y auditoría. Si pasan,
Render aplica las migraciones nuevas y publica la versión; Cloudflare vuelve a construir el
frontend por su cuenta.

**Cambios de base de datos**: siempre en un archivo nuevo `db/sql/migrations/V00N__descripcion.sql`.
Nunca edite uno ya aplicado: `migrar.js` lo detecta por su huella SHA-256 y detiene el despliegue.
Haga migraciones compatibles con la versión anterior (agregar antes de quitar): así, volver a la
versión anterior en Render (**Rollback**) no rompe nada.

**Migrar a mano** (ver qué falta o aplicar desde su computadora):
```bash
DATABASE_URL='<neon>' DATABASE_SSL=true npm run db:migrar -- --ver
DATABASE_URL='<neon>' DATABASE_SSL=true npm run db:migrar
```

**Respaldo propio** (mensual, y antes de cada migración grande):
```bash
pg_dump '<connection string de Neon>' -Fc -f respaldo_$(date +%Y%m%d).dump
```
Guárdelo cifrado y fuera de la computadora de caja. Pruebe restaurarlo en una base local al
menos una vez (`pg_restore -d <base_local> respaldo.dump`): un respaldo que nunca se probó no
cuenta.

**Rotar secretos**: si sospecha que se filtraron, cambie la clave en Neon (*Reset password*) y
actualice `DATABASE_URL` en Render. Para `JWT_SECRET`, genere uno nuevo con `openssl rand -hex 32`;
todas las sesiones se cierran.

**Correo de comprobantes**: cuando tenga proveedor SMTP y los registros SPF, DKIM y DMARC
publicados, agregue en Render las variables de la sección "Correo de comprobantes" del
[README](README.md) y ponga `CORREO_HABILITADO=true`.

**Dominio propio** (opcional, p. ej. `ventas.intelecto.com` y `api.intelecto.com`): agréguelo
en Cloudflare (Custom domains) y en Render (Custom Domains). Luego actualice `CORS_ORIGIN` en
Render y `API_URL` en Cloudflare, y vuelva a desplegar.
