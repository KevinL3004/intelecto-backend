import type { DatosEmpresa, LineaDeVenta, VentaCompleta } from '../ventas/consulta-venta';

/** Escapa texto para HTML. TODO dato que venga de la BD pasa por aquí (evita inyección en el correo). */
export const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const ESTADO: Record<string, string> = {
  RESERVADO: 'Reservado: recoger en el colegio',
  PENDIENTE_TRASLADO: 'Pendiente: viene de otro colegio',
  EN_TRANSITO: 'En camino desde otro colegio',
  PENDIENTE_PROVEEDOR: 'Pendiente: se pedirá al proveedor',
  EN_PEDIDO: 'Pedido al proveedor',
  ANULADO: 'Anulado',
};

const fechaGt = (d: Date | string) =>
  new Intl.DateTimeFormat('es-GT', {
    timeZone: 'America/Guatemala',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(d));

export interface BloqueAlumno {
  titulo: string;
  grado: string | null;
  licencia: string | null;
  descuento: string;
  lineas: LineaDeVenta[];
}

/** Agrupa las líneas por alumno (en el orden de la venta). Lo que no tiene alumno va al final. */
export function bloquesPorAlumno(v: VentaCompleta): BloqueAlumno[] {
  const bloques: BloqueAlumno[] = v.alumnos.map((a) => ({
    titulo: a.nombre,
    grado: a.grado,
    licencia: a.licencia,
    descuento: a.descuento,
    lineas: v.lineas.filter((l) => l.ventaAlumnoId === a.id),
  }));
  const sueltas = v.lineas.filter((l) => !l.ventaAlumnoId);
  if (sueltas.length)
    bloques.push({
      titulo: v.alumno || (bloques.length ? 'Otros' : 'Libros'),
      grado: v.alumnos.length ? null : v.grado,
      licencia: null,
      descuento: v.alumnos.length ? '0.00' : v.descuento,
      lineas: sueltas,
    });
  return bloques;
}

/** Comprobante por correo: HTML sencillo (tablas, estilos en línea) + versión de texto. */
const fechaCorta = (d: Date | string) =>
  new Intl.DateTimeFormat('es-GT', {
    timeZone: 'America/Guatemala',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(d));

/** Estado de entrega de la orden: "ENTREGADO" o "PENDIENTE DE ENTREGA" (con cuántos libros faltan). */
export function estadoDeEntrega(v: VentaCompleta) {
  if (v.estadoPago === 'ANULADA') return { completo: false, texto: 'VENTA ANULADA' };
  if (v.estadoEntrega === 'COMPLETA')
    return {
      completo: true,
      texto: `ENTREGADO${v.entregaCompletaEn ? ` el ${fechaCorta(v.entregaCompletaEn)}` : ''}`,
    };
  const faltan = v.lineas
    .filter((l) => l.estado !== 'ANULADO')
    .reduce((a, l) => a + (l.cantidad - l.cantidadEntregada), 0);
  return { completo: false, texto: `PENDIENTE DE ENTREGA: ${faltan} libro(s)` };
}

export function plantillaComprobante(
  v: VentaCompleta,
  e: DatosEmpresa,
  tipo: 'COMPROBANTE' | 'ENTREGA_COMPLETA' = 'COMPROBANTE',
) {
  const asunto =
    tipo === 'ENTREGA_COMPLETA'
      ? `Entrega completa ${v.codigo} · ${e.nombre}`
      : `Comprobante ${v.codigo} · ${e.nombre}`;
  const estado = estadoDeEntrega(v);
  const colorEstado = estado.completo
    ? '#047857'
    : v.estadoPago === 'ANULADA'
      ? '#e11d48'
      : '#b45309';
  const bloques = bloquesPorAlumno(v);
  const fila = (izq: string, der: string, estilo = '') =>
    `<tr><td style="padding:2px 0;${estilo}">${izq}</td><td style="padding:2px 0;text-align:right;${estilo}">${der}</td></tr>`;

  const htmlBloques = bloques
    .map((b) => {
      const lineas = b.lineas
        .map((l) =>
          fila(
            `${l.cantidad} × ${esc(l.titulo)}${
              l.estado === 'ENTREGADO' &&
              l.entregadoEn &&
              fechaCorta(l.entregadoEn) !== fechaCorta(v.fecha)
                ? `<br><span style="color:#047857;font-size:12px">Entregado el ${esc(fechaCorta(l.entregadoEn))}</span>`
                : ''
            }${
              ESTADO[l.estado]
                ? `<br><span style="color:#b45309;font-size:12px">${esc(ESTADO[l.estado])}${
                    l.colegioOrigen ? ` (${esc(l.colegioOrigen)})` : ''
                  }</span>`
                : ''
            }`,
            `Q${esc(l.subtotal)}`,
          ),
        )
        .join('');
      return `
        <div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px;margin:12px 0">
          <p style="margin:0;font-weight:600">Alumno: ${esc(b.titulo)}</p>
          ${b.grado ? `<p style="margin:2px 0 0;color:#52525b">Grado: ${esc(b.grado)}</p>` : ''}
          ${
            b.licencia
              ? `<p style="margin:8px 0 0;padding:8px;background:#f4f4f5;border-radius:6px">
                   Licencia digital: <strong style="font-family:monospace;font-size:15px">${esc(b.licencia)}</strong>
                   ${e.sitioLicencias ? `<br><span style="font-size:12px;color:#52525b">Úsela en ${esc(e.sitioLicencias)}</span>` : ''}
                 </p>`
              : ''
          }
          <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:8px;font-size:14px">
            ${lineas}
            ${b.descuento !== '0.00' ? fila('Descuento combo', `−Q${esc(b.descuento)}`, 'color:#047857') : ''}
          </table>
        </div>`;
    })
    .join('');

  const pagos = v.pagos
    .filter((p) => !p.anulado)
    .map((p) =>
      fila(
        `${esc(p.nombre)}${p.referencia ? ` · Ref. ${esc(p.referencia)}` : ''}${
          p.recargo !== '0.00' ? ` (recargo ${esc(p.recargoPct)} %: Q${esc(p.recargo)})` : ''
        }`,
        `Q${esc(p.montoTotal)}`,
      ),
    )
    .join('');

  const emisor = [
    e.nit && `NIT ${e.nit}`,
    e.direccion,
    e.telefono && `Tel. ${e.telefono}`,
    e.correo,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(asunto)}</title></head>
<body style="margin:0;padding:16px;background:#fafafa;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:20px">
    <p style="margin:0;font-size:20px;font-weight:700;text-align:center">${esc(e.nombre)}</p>
    ${emisor ? `<p style="margin:4px 0 0;font-size:12px;color:#52525b;text-align:center">${emisor}</p>` : ''}
    <p style="margin:12px 0 0;text-align:center;color:#52525b">Comprobante de compra · ${esc(v.colegio)}</p>
    <p style="margin:12px 0;padding:8px;border:1px solid ${colorEstado};color:${colorEstado};text-align:center;border-radius:6px;font-weight:700">${esc(estado.texto)}</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:12px;font-size:14px">
      ${fila('Venta', `<strong>${esc(v.codigo)}</strong>`)}
      ${fila('Fecha', esc(fechaGt(v.fecha)))}
      ${fila('Cliente', esc(v.cliente))}
      ${fila('NIT', esc(v.nit))}
    </table>
    ${htmlBloques}
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;border-top:1px solid #e4e4e7">
      ${fila('Subtotal', `Q${esc(v.subtotal)}`)}
      ${v.descuento !== '0.00' ? fila('Descuentos', `−Q${esc(v.descuento)}`) : ''}
      ${v.recargo !== '0.00' ? fila('Recargo por tarjeta', `Q${esc(v.recargo)}`) : ''}
      ${fila('<strong>Total</strong>', `<strong>Q${esc(v.total)}</strong>`, 'font-size:16px')}
    </table>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:8px;font-size:13px;color:#3f3f46">
      ${pagos}
    </table>
    ${
      v.lineas.some((l) => ESTADO[l.estado] && l.estado !== 'ANULADO')
        ? `<p style="margin:12px 0 0;padding:8px;border:1px solid #f59e0b;border-radius:6px;font-size:13px">
             Hay libros pendientes de entrega. Presente este comprobante (impreso o en su teléfono) para recogerlos.
           </p>`
        : ''
    }
    ${e.pie ? `<p style="margin:16px 0 0;font-size:12px;color:#71717a;text-align:center">${esc(e.pie)}</p>` : ''}
  </div>
  <p style="max-width:560px;margin:8px auto 0;font-size:11px;color:#a1a1aa;text-align:center">
    Recibió este correo porque registró su dirección al comprar en ${esc(e.nombre)}.
  </p>
</body></html>`;

  const texto = [
    `${e.nombre} — Comprobante ${v.codigo}`,
    `Fecha: ${fechaGt(v.fecha)} · ${v.colegio}`,
    `Cliente: ${v.cliente} · NIT ${v.nit}`,
    `Estado: ${estado.texto}`,
    '',
    ...bloques.flatMap((b) => [
      `Alumno: ${b.titulo}${b.grado ? ` (${b.grado})` : ''}`,
      ...(b.licencia
        ? [`  Licencia digital: ${b.licencia}${e.sitioLicencias ? ` — ${e.sitioLicencias}` : ''}`]
        : []),
      ...b.lineas.map(
        (l) =>
          `  ${l.cantidad} x ${l.titulo}  Q${l.subtotal}${ESTADO[l.estado] ? ` [${ESTADO[l.estado]}]` : ''}`,
      ),
      ...(b.descuento !== '0.00' ? [`  Descuento combo  -Q${b.descuento}`] : []),
      '',
    ]),
    `Total: Q${v.total}`,
    ...v.pagos.filter((p) => !p.anulado).map((p) => `  ${p.nombre}: Q${p.montoTotal}`),
    '',
    e.pie ?? '',
  ]
    .filter((x, i, a) => !(x === '' && a[i - 1] === ''))
    .join('\n');

  return { asunto, html, texto };
}
