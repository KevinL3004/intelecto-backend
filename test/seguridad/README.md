# Pruebas de ataque (seguridad e integridad)

**Solo contra una base de PRUEBA** (crean, editan, anulan y borran datos). Nunca contra producción.

1. Base de prueba con `01_schema`, `02_seed`, migraciones y `demo/03_datos_prueba.sql`.
2. API en modo desarrollo (Swagger activo, el fuzzer lee de ahí la lista de endpoints), p. ej. en :3100.
3. Ejecutar:

```bash
node test/seguridad/integridad.mjs http://localhost:3100   # concurrencia, montos, IDOR (~30 s)
node test/seguridad/fuzz.mjs http://localhost:3100         # ~56 000 peticiones (~10 min)
```

- `integridad.mjs`: aperturas de turno simultáneas, 10 ventas por 3 unidades, anulación/entrega/
  recepción dobles, manipulación de precios y pagos, acceso a datos de otro colegio, asignación
  masiva y búsqueda con inyección.
- `fuzz.mjs`: cada endpoint, cada campo (ruta, query, cuerpo) con inyección SQL (clásica, por
  tiempo con `pg_sleep`, UNION), tipos equivocados, desbordes, bytes nulos, prototipos y cuerpos
  malformados. Hallazgo = error 500, respuesta > 2 s o fuga de detalles internos. Deja
  `hallazgos.json`. Resultado esperado: `✅ Sin hallazgos`.

Usan la cabecera `X-Forwarded-For` para no chocar con el límite de peticiones; eso solo funciona
sin proxy delante (en Render la IP real la pone el proxy y no se puede falsear).
