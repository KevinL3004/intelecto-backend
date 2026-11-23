// Integridad de negocio y concurrencia (carreras) contra la API de prueba.
const B = (process.argv[2] ?? 'http://localhost:3100') + '/api/v1';
const T = {};
let n = 0;
const ip = () => `10.88.0.${n++ % 250}`;
const login = async (u) => {
  const r = await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ username: u, password: 'Prueba2026!' }) })).json();
  T[u] = r.access_token;
};
const call = async (u, m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { authorization: 'Bearer ' + T[u], 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
let fallas = 0;
const ok = (nom, c, extra = '') => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + nom + (extra ? '  → ' + extra : '')); };
const err = (r) => r.j?.error ?? r.s;
const exitos = (rs) => rs.filter((r) => r.s >= 200 && r.s < 300).length;
const a500 = (rs) => rs.filter((r) => r.s >= 500).length;

for (const u of ['admin', 'contador', 'cajero.norte', 'cajero.sur']) await login(u);
const libros = (await call('admin', 'GET', '/libros?limit=50')).j.data;
const L = (t) => libros.find((l) => l.titulo === t).id;
const colegios = (await call('admin', 'GET', '/colegios')).j.data;
const NORTE = colegios.find((c) => c.codigo === 'COL-NORTE').id, SUR = colegios.find((c) => c.codigo === 'COL-SUR').id;
const metodos = (await call('admin', 'GET', '/metodos-pago')).j;
const TR = metodos.find((m) => m.codigo === 'TRANSFERENCIA').id;
const cliente = (await call('admin', 'GET', '/personas?q=garcia')).j.data[0];
const inv = async (col, id) => (await call('admin', 'GET', `/inventario?colegioId=${col}`)).j.find((f) => f.libroId === id);
const libro = L('Matemática Activa 1');

// Turno para cajero.norte
const caja = (await call('cajero.norte', 'GET', '/cajas/disponibles')).j[0];
console.log('--- Turno: 6 aperturas simultáneas del mismo cajero');
let rs = await Promise.all(Array.from({ length: 6 }, () => call('cajero.norte', 'POST', '/turnos', { cajaId: caja.id, conteo: [], observacion: 'prueba carrera' })));
ok('solo una apertura gana, sin errores 500', exitos(rs) === 1 && a500(rs) === 0, rs.map((r) => r.s).join(','));

console.log('--- Stock: 10 ventas simultáneas compitiendo por 3 unidades');
await call('admin', 'POST', '/inventario/ajuste', { colegioId: NORTE, libroId: libro, existencia: 3, motivo: 'Prueba de concurrencia' });
const i0 = await inv(NORTE, libro);
const cot = (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [{ libroId: libro, cantidad: 1 }] })).j;
rs = await Promise.all(Array.from({ length: 10 }, (_, k) => call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: [{ libroId: libro, cantidad: 1 }], pagos: [{ metodoPagoId: TR, montoBase: cot.aPagar, referencia: 'CARRERA-' + k }] })));
const i1 = await inv(NORTE, libro);
const ventas = rs.filter((r) => r.s === 201 || r.s === 200).map((r) => r.j);
const entregadas = ventas.flatMap((v) => v.lineas).filter((l) => l.estado === 'ENTREGADO').length;
ok('las 10 ventas se registran sin 500 (las que no alcanzan quedan pendientes)', ventas.length === 10 && a500(rs) === 0, rs.map((r) => r.s + ':' + (r.j?.error ?? '')).join(','));
ok('se entregaron exactamente 3 (nunca más que la existencia)', entregadas === 3, `entregadas=${entregadas}`);
ok('la existencia nunca queda negativa', [i1.existencia, i1.reservado, i1.disponible].every((v) => v >= 0), JSON.stringify(i1));
console.log('     antes', JSON.stringify(i0), '\n     después', JSON.stringify(i1));

console.log('--- Anulación: 5 anulaciones simultáneas de la misma venta');
const v1 = ventas.find((v) => v.lineas[0].estado === 'ENTREGADO');
const antesAnul = await inv(NORTE, libro);
rs = await Promise.all(Array.from({ length: 5 }, () => call('admin', 'POST', `/ventas/${v1.id}/anular`, { motivo: 'Prueba de carrera', devuelveLibros: true })));
const despAnul = await inv(NORTE, libro);
ok('solo una anulación gana', exitos(rs) === 1 && a500(rs) === 0, rs.map((r) => r.s + ':' + (r.j?.error ?? '')).join(','));
ok('el libro se devuelve al inventario una sola vez', despAnul.existencia - antesAnul.existencia <= 1, `${antesAnul.existencia} → ${despAnul.existencia}`);

console.log('--- Entrega: 5 entregas simultáneas de la misma línea');
await call('admin', 'POST', '/inventario/ajuste', { colegioId: NORTE, libroId: libro, existencia: 20, motivo: 'Prueba de concurrencia' });
const cot2 = (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [{ libroId: libro, cantidad: 2 }], entregarAhora: false })).j;
const vr = (await call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: [{ libroId: libro, cantidad: 2 }], entregarAhora: false, pagos: [{ metodoPagoId: TR, montoBase: cot2.aPagar, referencia: 'RECOGE-1' }] })).j;
const linea = vr.lineas[0];
const e0 = await inv(NORTE, libro);
rs = await Promise.all(Array.from({ length: 5 }, () => call('cajero.norte', 'POST', `/ventas/${vr.id}/entregas`, { lineas: [{ detalleId: linea.id, cantidad: 2 }] })));
const e1 = await inv(NORTE, libro);
const vfin = (await call('admin', 'GET', `/ventas/${vr.id}`)).j;
ok('solo una entrega gana', exitos(rs) === 1 && a500(rs) === 0, rs.map((r) => r.s + ':' + (r.j?.error ?? '')).join(','));
ok('no se entrega más de lo vendido', vfin.lineas[0].cantidadEntregada === 2, JSON.stringify(vfin.lineas[0]).slice(0, 160));
ok('la existencia baja exactamente 2', e0.existencia - e1.existencia === 2, `${e0.existencia} → ${e1.existencia}`);

console.log('--- Traslado: 4 recepciones simultáneas');
const t = (await call('admin', 'POST', '/traslados', { origenId: NORTE, destinoId: SUR, despachar: true, items: [{ libroId: libro, cantidad: 2 }] })).j;
const s0 = await inv(SUR, libro);
rs = await Promise.all(Array.from({ length: 4 }, () => call('admin', 'POST', `/traslados/${t.id}/recibir`, { items: [{ libroId: libro, recibido: 2 }] })));
const s1 = await inv(SUR, libro);
ok('solo una recepción gana', exitos(rs) === 1 && a500(rs) === 0, rs.map((r) => r.s + ':' + (r.j?.error ?? '')).join(','));
ok('el destino suma 2 una sola vez', (s1?.existencia ?? 0) - (s0?.existencia ?? 0) === 2, `${s0?.existencia} → ${s1?.existencia}`);

console.log('--- Manipulación de precios y montos');
const linea1 = [{ libroId: libro, cantidad: 1 }];
ok('no se puede mandar el precio desde el cliente', (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [{ libroId: libro, cantidad: 1, precioUnitario: '0.01' }] })).s === 400);
ok('no se puede mandar el total ni el descuento', (await call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: linea1, total: '1.00', descuento: '99', pagos: [{ metodoPagoId: TR, montoBase: '1.00', referencia: 'X' }] })).s === 400);
ok('pagar menos del total → PAGOS_NO_CUADRAN', err(await call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: linea1, pagos: [{ metodoPagoId: TR, montoBase: '0.01', referencia: 'X' }] })) === 'PAGOS_NO_CUADRAN');
ok('monto negativo → 400', (await call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: linea1, pagos: [{ metodoPagoId: TR, montoBase: '-50.00', referencia: 'X' }] })).s === 400);
ok('cantidad 0 o negativa → 400', (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [{ libroId: libro, cantidad: -3 }] })).s === 400);
ok('libro inexistente → 4xx (no 500)', (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [{ libroId: 987654, cantidad: 1 }] })).s < 500);
ok('método de pago inexistente → 4xx', (await call('cajero.norte', 'POST', '/ventas', { clienteId: cliente.id, lineas: linea1, pagos: [{ metodoPagoId: 98765, montoBase: cot.aPagar, referencia: 'X' }] })).s < 500);
ok('mismo libro repetido en líneas no duplica descuentos ni rompe', (await call('cajero.norte', 'POST', '/ventas/cotizar', { lineas: [linea1[0], linea1[0]] })).s < 500);
const comboSur = (await call('admin', 'GET', `/combos?colegioId=${SUR}`)).j?.data?.[0] ?? (await call('admin', 'GET', `/combos?colegioId=${SUR}`)).j?.[0];
if (comboSur) {
  const c = (await call('cajero.norte', 'POST', '/ventas/cotizar', { comboId: comboSur.id, lineas: linea1 })).j;
  ok('combo de otro colegio no da descuento en Norte', c?.descuento === '0.00' || c?.error, JSON.stringify(c).slice(0, 120));
}

console.log('--- Acceso a datos ajenos (IDOR) y asignación masiva');
const ventaNorte = ventas[1];
ok('cajero.sur no ve una venta de Norte', [403, 404].includes((await call('cajero.sur', 'GET', `/ventas/${ventaNorte.id}`)).s));
ok('cajero.sur no reimprime comprobante de Norte', [403, 404].includes((await call('cajero.sur', 'GET', `/ventas/${ventaNorte.id}/comprobante`)).s));
ok('cajero.sur no entrega en una venta de Norte', [403, 404].includes((await call('cajero.sur', 'POST', `/ventas/${vr.id}/entregas`, { lineas: [{ detalleId: linea.id, cantidad: 1 }] })).s));
ok('cajero no lista usuarios', (await call('cajero.norte', 'GET', '/usuarios')).s === 403);
ok('cajero no lee la bitácora', (await call('cajero.norte', 'GET', '/bitacora')).s === 403);
ok('contador no crea administradores', [400, 403].includes((await call('contador', 'POST', '/usuarios', { persona: { nombres: 'X' }, username: 'nuevo.admin', password: 'Fuerte-Clave-2026x', rol: 'ADMIN' })).s));
ok('campos extra (id, rol) en persona → 400', (await call('admin', 'POST', '/personas', { nombres: 'X', id: 1, rol: 'ADMIN' })).s === 400);
ok('prototype pollution en el cuerpo → 400', (await fetch(B + '/personas', { method: 'POST', headers: { authorization: 'Bearer ' + T.admin, 'content-type': 'application/json' }, body: '{"nombres":"X","__proto__":{"rol":"ADMIN"}}' })).status === 400);
const perfil = (await call('cajero.norte', 'GET', '/auth/perfil')).j;
ok('el perfil del cajero sigue siendo CAJERO', perfil.rol === 'CAJERO');

console.log('--- Inyección guardada como texto (no se ejecuta)');
const sqli = "Robert'); DROP TABLE alumno;-- <script>alert(1)</script>";
const p = (await call('admin', 'POST', '/personas', { nombres: sqli, apellidos: "O'Brien" })).j;
const leida = (await call('admin', 'GET', `/personas/${p.id}`)).j;
ok('se guarda literal y se lee igual', leida.nombres === sqli && leida.apellidos === "O'Brien");
ok('la tabla alumno sigue existiendo', (await call('admin', 'GET', '/alumnos?limit=1')).s === 200);
const busq = (await call('admin', 'GET', `/personas?q=${encodeURIComponent("' OR '1'='1")}`)).j;
ok("búsqueda con ' OR '1'='1 no devuelve todo", busq.total === 0, `total=${busq.total}`);
const comodin = (await call('admin', 'GET', `/personas?q=${encodeURIComponent('%')}`)).j;
ok('el comodín % se busca literal (no devuelve todo)', comodin.total === 0, `total=${comodin.total}`);

console.log('\n' + (fallas ? `❌ ${fallas} prueba(s) fallaron` : '✅ Integridad y concurrencia: todo pasó'));
