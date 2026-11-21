# Seguridad — Sistema de Ventas Intelecto (SVI)

El SVI maneja datos personales (nombre, NIT, DPI, teléfono, correo) y dinero (ventas, pagos,
cierres de caja). Este documento resume los controles implementados, cómo reportar una
vulnerabilidad y qué verificar antes de cada despliegue a producción. La referencia es
**OWASP ASVS 4.0, nivel 2**.

## Reportar una vulnerabilidad

No abra un *issue* público. Use **GitHub → Security → Report a vulnerability** (reporte privado)
en este repositorio. Se responde en un máximo de 5 días hábiles.

## Controles implementados

### Autenticación y sesiones (ASVS V2, V3)
| Control | Detalle |
|---|---|
| Contraseñas | bcrypt costo 12; hashes antiguos se actualizan al iniciar sesión. Política: 12+ caracteres, ≤ 72 bytes (límite de bcrypt), mayúscula/minúscula/número, sin palabras comunes, el nombre del sistema ni el usuario. |
| Fuerza bruta | 10 intentos de login por minuto por IP; bloqueo de la cuenta 15 min tras 5 fallos; ambos quedan en bitácora. |
| Enumeración | Mismo mensaje para usuario inexistente y contraseña errónea; comparación contra un hash señuelo para que el tiempo de respuesta no revele si el usuario existe. |
| Token de acceso | JWT HS256 de 15 min; algoritmo, emisor y audiencia verificados; incluye el id de sesión. |
| Refresh token | Opaco (`<sesión>.<256 bits aleatorios>`); en BD solo su SHA-256. **Rota** en cada uso; presentar uno ya usado **revoca la sesión** (posible robo) y se registra. |
| Revocación | Logout, cambio o restablecimiento de contraseña y desactivación del usuario revocan las sesiones. Vida máxima 7 días; 12 h de inactividad la expiran. |
| Estado en vivo | Rol, colegio y estado activo se leen de la BD (caché ≤ 30 s), no del token. |
| Primer administrador | El seed lo crea **sin contraseña utilizable**; se asigna con `npm run usuario:password -- admin`. |

### Control de acceso (ASVS V4)
- Permisos validados en el backend (`@Roles`); el frontend solo oculta opciones.
- El cajero solo opera su colegio y sus ventas (verificado en servicios, no solo en rutas).
- Pruebas automatizadas de permisos por rol.

### Validación y datos (ASVS V5, V8)
- DTOs con `class-validator`, `whitelist` y `forbidNonWhitelisted` (rechaza campos extra).
- Todo SQL usa parámetros (`$1…`); búsquedas escapan `%` y `_`.
- Montos con `decimal.js` y `NUMERIC(12,2)`; reglas de dinero con pruebas unitarias.
- Peticiones limitadas a 200 KB.
- Respuestas con `Cache-Control: no-store` (datos personales y financieros).

### Transporte y cabeceras (ASVS V9, V14)
- HTTPS en Render/Cloudflare; HSTS de 1 año con `preload`.
- CSP `default-src 'none'` en producción, `nosniff`, `no-referrer`, sin `X-Powered-By`.
- CORS solo para los orígenes de `CORS_ORIGIN` (en producción, solo `https://`).
- Conexión a PostgreSQL con TLS **verificando el certificado** del servidor.

### Auditoría (ASVS V7)
- Bitácora de toda acción sobre dinero, stock, usuarios y configuración: usuario, fecha, IP,
  valor anterior y nuevo. La IP es la que entrega el proxy de confianza (no falsificable).
- Nunca se registran contraseñas, hashes, tokens ni secretos.

### Configuración y cadena de suministro (ASVS V10, V14)
- La API **no arranca** con variables faltantes, secretos de menos de 32 caracteres, valores
  de ejemplo, `CORS_ORIGIN=*` o sin TLS a la BD en producción.
- Dependencias con versión exacta, publicadas hace al menos 2 semanas; `npm audit` en 0
  (producción y desarrollo) y obligatorio en CI.
- `npm ci --ignore-scripts` (ningún paquete ejecuta código al instalarse).
- Contenedor sin root, Node 24 LTS; acciones de GitHub fijadas por hash; CI con permisos mínimos.
- CodeQL (`security-extended`) en cada cambio y semanalmente; Dependabot semanal.

## Lista de verificación para producción

- [ ] `JWT_SECRET` generado con `openssl rand -hex 32`, guardado solo en Render.
- [ ] `DATABASE_SSL=true`, `NODE_ENV=production`, `CORS_ORIGIN=https://…` (dominio real).
- [ ] Migraciones aplicadas en orden (`db/sql/migrations/V*.sql`).
- [ ] Contraseña del primer admin asignada con `npm run usuario:password -- admin`; cambiada al entrar.
- [ ] **Nunca** ejecutar `db/sql/demo/` en producción.
- [ ] En GitHub: activar *secret scanning*, *push protection*, *Dependabot alerts* y
      *private vulnerability reporting*; proteger `main` (PR + CI en verde).
- [ ] Respaldos de Neon verificados (restauración de prueba).

## Limitaciones conocidas y siguientes pasos

- **Sin segundo factor (MFA).** Recomendado para Admin y Contador antes de producción.
- **Cachés y límite de intentos en memoria de cada instancia.** Con más de una instancia, una
  revocación tarda hasta 30 s en verse en las demás, y el límite de intentos se cuenta por
  instancia. Con una sola instancia (plan actual) no aplica.
- **Tokens en `sessionStorage`** del navegador. Se mitiga con CSP estricta en el frontend, tokens
  de acceso cortos y rotación; la sesión termina al cerrar la pestaña.
- Retención de bitácora y de datos personales por definir con Intelecto (Ley de acceso a la
  información y normativa aplicable).
