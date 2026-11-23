// Fuzzer de la API: inyección SQL, tipos de datos, desbordes y fugas de información.
// Uso: node fuzz.mjs [http://localhost:3100]  → imprime hallazgos y guarda hallazgos.json
import { writeFileSync } from 'node:fs';
const BASE = (process.argv[2] ?? 'http://localhost:3100') + '/api/v1';
const LENTO_MS = 2000;
let ipN = 0;
const ip = () => `10.77.${(ipN >> 8) & 255}.${ipN++ & 255}`; // evita el limitador (solo en pruebas)

const hallazgos = [];
const vistos = new Set();
let total = 0;
const FUGA = /QueryFailed|syntax error|relation "|column "|violates|duplicate key|invalid input|out of range|node_modules|\bat \w+ \(|TypeORM|postgres|\bstack\b|ECONN|Cannot read prop|undefined is not/i;

async function req(m, path, { body, token, raw, ctype = 'application/json' } = {}) {
  total++;
  const t0 = performance.now();
  let r, txt;
  try {
    r = await fetch(BASE + path, {
      method: m,
      headers: { 'content-type': ctype, 'x-forwarded-for': ip(), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    txt = await r.text();
  } catch (e) {
    return { s: 0, ms: performance.now() - t0, txt: String(e) };
  }
  return { s: r.status, ms: performance.now() - t0, txt, h: r.headers };
}

function anotar(tipo, ep, campo, carga, r) {
  const clave = `${tipo}|${ep}|${campo}`;
  if (vistos.has(clave)) return;
  vistos.add(clave);
  hallazgos.push({ tipo, ep, campo, carga: JSON.stringify(carga)?.slice(0, 80), status: r.s, ms: Math.round(r.ms), resp: r.txt?.slice(0, 220) });
}
function revisar(ep, campo, carga, r) {
  if (r.s >= 500 || r.s === 0) anotar('ERROR_500', ep, campo, carga, r);
  if (r.ms > LENTO_MS) anotar('LENTO(posible SQLi por tiempo)', ep, campo, carga, r);
  if (FUGA.test(r.txt ?? '')) anotar('FUGA_INFO', ep, campo, carga, r);
}

// ---------- Cargas ----------
const SQLI = [
  "' OR '1'='1",
  "1 OR 1=1",
  "1; DROP TABLE venta; --",
  "' UNION SELECT username, password_hash FROM usuario --",
  "1' AND (SELECT pg_sleep(3)) IS NULL --",
  "1); SELECT pg_sleep(3); --",
  "'||(SELECT pg_sleep(3))||'",
  "%' OR f_norm('a') LIKE '%",
  "\\' OR 1=1 --",
  '$1',
  ':q',
  "'; UPDATE usuario SET rol='ADMIN'; --",
];
const TIPOS = [
  null, true, false, 0, -1, 1.5, 1e20, 2147483648, 9007199254740993, -9999999999,
  '1e20', 'NaN', 'Infinity', '-0', '0x1F', [], [1, 2], {}, { $gt: '' }, { __proto__: { admin: true } },
  '', '   ', '\u0000', 'a\u0000b', 'x'.repeat(20000), '😀'.repeat(80), '<script>alert(1)</script>',
  '../../../etc/passwd', '\r\nSet-Cookie: x=1', '٣', '１２３',
];
const CARGAS = [...SQLI, ...TIPOS];
const IDS_RUTA = ["1 OR 1=1", "1;DROP TABLE venta", "-1", "0", "99999999999999999999", "9223372036854775808", "1.5", "abc", "1e3", "%27", "%00", "0x10", "1%20OR%201=1", "+2"];

// ---------- Valores base válidos por nombre de campo ----------
const BASE_CAMPO = {
  username: 'fuzz.user', password: 'Fuerte-Clave-2026x', nueva: 'Otra-Fuerte-Clave-2026', actual: 'x',
  nit: 'CF', dpi: '1234567890123', telefono: '5555-1234', correo: 'a@b.com', destinatario: 'a@b.com',
  isbn: '978-1-23456-789-7', codigo: 'FZ-01', licencia: 'LIC-001',
  monto: '10.00', montoBase: '10.00', recibido: '10.00', precio: '10.00', descuento: '1.00', fondoAsignado: '100.00',
  recargoPct: '0', porcentaje: '0', valor: '5', refresh_token: 'x'.repeat(40),
  ciclo: 2027, numero: 7, orden: 1, cantidad: 1, solicitado: 1, recibido_: 1, existencia: 1,
};
function base(schema, comp, nombre) {
  if (!schema) return undefined;
  if (schema.$ref) return base(comp[schema.$ref.split('/').pop()], comp, nombre);
  if (schema.allOf) return base(schema.allOf[0], comp, nombre);
  if (nombre && nombre in BASE_CAMPO && schema.type !== 'object' && schema.type !== 'array') {
    const v = BASE_CAMPO[nombre];
    return schema.type === 'integer' || schema.type === 'number' ? (typeof v === 'number' ? v : 1) : v;
  }
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const o = {};
      for (const [k, s] of Object.entries(schema.properties ?? {})) o[k] = base(s, comp, k);
      return o;
    }
    case 'array': return [base(schema.items, comp, nombre)];
    case 'integer': case 'number': return 1;
    case 'boolean': return false;
    default: return schema.example ?? 'Prueba fuzz';
  }
}
// Rutas de un campo (a.b[0].c) para mutarlo uno por uno.
function rutas(o, pre = []) {
  if (o === null || typeof o !== 'object') return [pre];
  const out = pre.length ? [pre] : [];
  for (const [k, v] of Object.entries(o)) out.push(...rutas(v, [...pre, k]));
  return out;
}
function conValor(o, ruta, v) {
  const c = structuredClone(o);
  if (!ruta.length) return v;
  let x = c;
  for (const k of ruta.slice(0, -1)) x = x[k];
  x[ruta.at(-1)] = v;
  return c;
}

// ---------- Ejecución ----------
const login = async (u) => JSON.parse((await req('POST', '/auth/login', { body: { username: u, password: 'Prueba2026!' } })).txt).access_token;
let token = await login('admin');
const doc = JSON.parse(await (await fetch(BASE.replace('/api/v1', '') + '/api/docs-json')).text());
const comp = doc.components.schemas;

// No se tocan: cierran la sesión del fuzzer o cambian su contraseña.
const EXCLUIR = new Set(['POST /auth/logout', 'PATCH /auth/password']);
const QUERY = ['q', 'colegioId', 'page', 'limit', 'activo', 'estado', 'desde', 'hasta', 'cajaId', 'usuarioId', 'metodoPagoId', 'entidad', 'formato', 'libroId', 'gradoId', 'ciclo', 'dias', 'turnoId', 'clienteId', 'estadoPago', 'estadoEntrega', 'pendientesEntrega', 'soloConExistencia'];

const eps = [];
for (const [p, ops] of Object.entries(doc.paths))
  for (const [m, d] of Object.entries(ops)) eps.push({ m: m.toUpperCase(), p: p.replace('/api/v1', ''), d });

// Usuario desechable para las rutas /usuarios/{id} (no tocar al admin que ejecuta el fuzzer).
let victima = 1;
{
  const r = await req('POST', '/usuarios', { token, body: { persona: { nombres: 'Victima', apellidos: 'Fuzz' }, username: 'victima.fuzz', password: 'Fuerte-Clave-2026x', rol: 'CAJERO', colegioId: 1 } });
  victima = JSON.parse(r.txt).id ?? 1;
  console.log('usuario desechable', victima, r.s);
}
const vivo = async () => {
  const r = await req('GET', '/auth/perfil', { token });
  if (r.s === 401) token = await login('admin');
};

for (const { m, p, d } of eps) {
  const ep = `${m} ${p}`;
  if (EXCLUIR.has(ep)) continue;
  await vivo();
  const rutaBase = (p.startsWith('/usuarios/{id}') ? p.replace('{id}', String(victima)) : p).replace(/\{tipo\}/, 'ventas').replace(/\{clave\}/, 'ciclo_vigente').replace(/\{[^}]+\}/g, '1');
  const esquema = d.requestBody?.content?.['application/json']?.schema;
  const cuerpo = esquema ? base(esquema, comp) : undefined;

  // 1) Parámetros de ruta
  const params = [...p.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
  for (const prm of params)
    for (const v of IDS_RUTA) {
      const ruta = p.replace(`{${prm}}`, encodeURIComponent(v).replace(/%25/g, '%')).replace(/\{tipo\}/, 'ventas').replace(/\{clave\}/, 'ciclo_vigente').replace(/\{[^}]+\}/g, '1');
      if (m === 'DELETE' || m !== 'GET') {
        // en escrituras solo se prueba la ruta con cuerpo base (no se borra nada real: ids inválidos)
      }
      const r = await req(m, ruta, { token, body: cuerpo });
      revisar(ep, `ruta:${prm}`, v, r);
      if (r.s >= 200 && r.s < 300 && !/^\d+$/.test(v)) anotar('ACEPTA_ID_INVALIDO', ep, `ruta:${prm}`, v, r);
    }
  if (m === 'DELETE') continue; // no borrar registros reales con ids válidos

  // 2) Query string (GET)
  if (m === 'GET')
    for (const k of QUERY)
      for (const v of CARGAS) {
        if (v !== null && typeof v === 'object') {
          const qs = Array.isArray(v) ? v.map((x) => `${k}=${encodeURIComponent(x)}`).join('&') : `${k}[$gt]=`;
          revisar(ep, `query:${k}`, v, await req(m, `${rutaBase}?${qs || k + '[]='}`, { token }));
          continue;
        }
        revisar(ep, `query:${k}`, v, await req(m, `${rutaBase}?${k}=${encodeURIComponent(String(v))}`, { token }));
      }

  // 3) Cuerpo JSON (un campo a la vez) + cuerpos malformados
  if (cuerpo !== undefined) {
    for (const ruta of rutas(cuerpo))
      for (const v of CARGAS) revisar(ep, `body:${ruta.join('.')}`, v, await req(m, rutaBase, { token, body: conValor(cuerpo, ruta, v) }));
    for (const raw of ['{', '[]', 'null', '"x"', '{"a":' + '['.repeat(5000) + ']'.repeat(5000) + '}', '{"__proto__":{"rol":"ADMIN"}}', '{"constructor":{"prototype":{"x":1}}}'])
      revisar(ep, 'body:<malformado>', raw.slice(0, 40), await req(m, rutaBase, { token, raw }));
    revisar(ep, 'body:<text/plain>', 'texto', await req(m, rutaBase, { token, raw: 'a=1', ctype: 'text/plain' }));
    revisar(ep, 'body:<xml>', 'xml', await req(m, rutaBase, { token, raw: '<a>1</a>', ctype: 'application/xml' }));
  }
  process.stdout.write('.');
}

// 4) Integridad de la base después del ataque
await vivo();
const salud = await req('GET', '/health');
const usuarios = JSON.parse((await req('GET', '/usuarios?limit=200', { token })).txt);
const ventas = await req('GET', '/ventas?limit=1', { token });
console.log(`\n\nPeticiones: ${total}  ·  endpoints: ${eps.length}`);
console.log('Salud tras el ataque:', salud.s, salud.txt.slice(0, 80));
console.log('Tabla venta sigue respondiendo:', ventas.s);
console.log('Roles de usuarios:', (usuarios.data ?? []).map((u) => `${u.username}:${u.rol}`).join(', '));
writeFileSync('hallazgos.json', JSON.stringify(hallazgos, null, 1));
const porTipo = {};
for (const h of hallazgos) (porTipo[h.tipo] ??= []).push(h);
for (const [t, hs] of Object.entries(porTipo)) {
  console.log(`\n### ${t}: ${hs.length}`);
  for (const h of hs) console.log(`  ${h.ep}  ${h.campo}  carga=${h.carga}  → ${h.status} ${h.ms}ms  ${h.resp?.replace(/\s+/g, ' ').slice(0, 150)}`);
}
console.log(hallazgos.length ? `\n❌ ${hallazgos.length} hallazgo(s)` : '\n✅ Sin hallazgos');
