#!/usr/bin/env node
/**
 * Aplica el esquema y las migraciones pendientes, llevando registro de lo aplicado.
 *
 *   npm run db:migrar                         aplica lo pendiente
 *   npm run db:migrar -- --ver                solo muestra qué aplicaría
 *   npm run db:migrar -- --registrar-existentes
 *        para una base que ya tenía todo aplicado a mano (antes de existir este script):
 *        marca como aplicados los archivos actuales sin ejecutarlos.
 *
 * Lee DATABASE_URL y DATABASE_SSL del entorno o del .env.
 * - Base vacía: 01_schema.sql → 02_seed.sql → migrations/V*.sql, en orden.
 * - Cada archivo corre en su propia transacción: si falla, no queda a medias.
 * - Guarda el SHA-256 de cada archivo: si alguien modifica una migración ya aplicada, se detiene.
 * - NUNCA aplica db/sql/demo (datos de prueba).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const SQL = path.join(__dirname, '..', 'db', 'sql');

function cargarEnv() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(linea.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
}

/** Archivos en el orden en que deben aplicarse. */
function archivos() {
  const migraciones = fs
    .readdirSync(path.join(SQL, 'migrations'))
    .filter((f) => /^V\d{3}__[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => `migrations/${f}`);
  return ['01_schema.sql', '02_seed.sql', ...migraciones].map((nombre) => {
    const sql = fs.readFileSync(path.join(SQL, nombre), 'utf8');
    return { nombre, sql, sha: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}

(async () => {
  cargarEnv();
  const ver = process.argv.includes('--ver');
  const registrar = process.argv.includes('--registrar-existentes');
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const ssl = String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: true } : false;
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl });
  await db.connect();
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`Base: ${host}`);

  try {
    // Un solo proceso a la vez (evita dos despliegues aplicando lo mismo).
    await db.query('SELECT pg_advisory_lock(727001)');
    const registro = (await db.query(`SELECT to_regclass('public.migracion_aplicada') IS NOT NULL AS hay`)).rows[0].hay;
    if (!registro && !ver)
      await db.query(`CREATE TABLE migracion_aplicada (
        nombre      TEXT PRIMARY KEY,
        sha256      TEXT NOT NULL,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const hechas = new Map(
      registro
        ? (await db.query('SELECT nombre, sha256 FROM migracion_aplicada')).rows.map((r) => [r.nombre, r.sha256])
        : [],
    );
    const { rows } = await db.query(`SELECT to_regclass('public.usuario') IS NOT NULL AS existe`);
    const conEsquema = rows[0].existe;

    if (conEsquema && hechas.size === 0 && !registrar) {
      console.error(
        'La base ya tiene el esquema pero no hay registro de migraciones (se aplicaron a mano).\n' +
          'Si TODOS los archivos actuales ya están aplicados, ejecute:\n' +
          '  npm run db:migrar -- --registrar-existentes',
      );
      process.exit(1);
    }

    let aplicadas = 0;
    for (const a of archivos()) {
      const sha = hechas.get(a.nombre);
      if (sha) {
        if (sha !== a.sha) {
          console.error(
            `✗ ${a.nombre} fue MODIFICADO después de aplicarse. No se cambian migraciones aplicadas:\n` +
              '  cree una nueva V00N__descripcion.sql con el cambio.',
          );
          process.exit(1);
        }
        continue;
      }
      if (ver) {
        console.log(`  pendiente: ${a.nombre}`);
        continue;
      }
      if (registrar) {
        await db.query('INSERT INTO migracion_aplicada (nombre, sha256) VALUES ($1, $2)', [a.nombre, a.sha]);
        console.log(`  registrado (sin ejecutar): ${a.nombre}`);
        continue;
      }
      process.stdout.write(`  aplicando ${a.nombre} … `);
      try {
        await db.query('BEGIN');
        await db.query(a.sql);
        await db.query('INSERT INTO migracion_aplicada (nombre, sha256) VALUES ($1, $2)', [a.nombre, a.sha]);
        await db.query('COMMIT');
        aplicadas++;
        console.log('ok');
      } catch (e) {
        await db.query('ROLLBACK');
        console.log('FALLÓ (no se aplicó nada de este archivo)');
        console.error(`  ${e.message}`);
        process.exit(1);
      }
    }
    if (!ver && !registrar) console.log(aplicadas ? `✓ ${aplicadas} archivo(s) aplicado(s)` : '✓ La base ya estaba al día');
  } finally {
    await db.end().catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
