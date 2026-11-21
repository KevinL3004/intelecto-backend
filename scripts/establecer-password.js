#!/usr/bin/env node
/**
 * Asigna una contraseña a un usuario directamente en la BD (primer admin, recuperación).
 *   npm run usuario:password -- <usuario>
 * Lee DATABASE_URL (y DATABASE_SSL) del entorno o del .env. Pide la contraseña sin mostrarla,
 * aplica la política del sistema y obliga a cambiarla en el siguiente ingreso.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { problemasPassword, BCRYPT_COSTO } = require('../dist/common/utils/password');

function cargarEnv() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(linea.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
}

function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(texto) ? s : '');
    rl.question(texto, (r) => {
      rl.close();
      process.stdout.write('\n');
      resolve(r);
    });
  });
}

(async () => {
  cargarEnv();
  const usuario = process.argv[2];
  if (!usuario) {
    console.error('Uso: npm run usuario:password -- <usuario>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const p1 = process.env.NUEVA_PASSWORD ?? (await preguntarOculto(`Nueva contraseña para ${usuario}: `));
  const p2 = process.env.NUEVA_PASSWORD ?? (await preguntarOculto('Repita la contraseña: '));
  if (p1 !== p2) {
    console.error('Las contraseñas no coinciden');
    process.exit(1);
  }
  const problemas = problemasPassword(p1, usuario);
  if (problemas.length) {
    console.error('Contraseña insegura: ' + problemas.join('; '));
    process.exit(1);
  }
  const ssl = String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: true } : false;
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl });
  await db.connect();
  try {
    await db.query('BEGIN');
    const r = await db.query(
      `UPDATE usuario SET password_hash = $2, debe_cambiar_password = true, intentos_fallidos = 0,
              bloqueado_hasta = NULL WHERE lower(username) = lower($1) RETURNING id`,
      [usuario, await bcrypt.hash(p1, BCRYPT_COSTO)],
    );
    if (!r.rowCount) throw new Error(`No existe el usuario "${usuario}"`);
    // Quien tuviera la contraseña anterior pierde el acceso.
    await db.query(
      `UPDATE sesion SET revocada_en = now(), motivo_revocacion = 'RESET_PASSWORD'
        WHERE usuario_id = $1 AND revocada_en IS NULL`,
      [r.rows[0].id],
    );
    await db.query(
      `INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, ip) VALUES (NULL, 'RESET_PASSWORD_CONSOLA', 'usuario', $1, 'consola')`,
      [String(r.rows[0].id)],
    );
    await db.query('COMMIT');
    console.log(`Contraseña asignada a "${usuario}". Deberá cambiarla al ingresar.`);
  } catch (e) {
    await db.query('ROLLBACK');
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
