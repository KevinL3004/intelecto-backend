import { EntityManager } from 'typeorm';

type Consultor = Pick<EntityManager, 'query'>;

/**
 * Carga una venta completa (cabecera, alumnos, líneas, pagos y correos). No valida permisos:
 * eso lo hace quien la llama (VentasService) — el envío de correos la usa sin usuario.
 */
export async function consultarVenta(m: Consultor, id: number) {
  const [v] = await m.query(
    `SELECT v.id, v.codigo, v.canal, v.colegio_id AS "colegioId", co.nombre AS colegio, v.ciclo,
            v.cliente_id AS "clienteId", trim(pc.nombres || ' ' || pc.apellidos) AS cliente, pc.nit,
            pc.telefono AS "clienteTelefono", pc.correo AS "clienteCorreo",
            v.alumno, v.grado_id AS "gradoId", g.nombre AS grado,
            v.subtotal, v.descuento, v.recargo, v.total, v.estado_pago AS "estadoPago",
            v.estado_entrega AS "estadoEntrega", v.observacion, v.fecha,
            v.usuario_id AS "usuarioId", us.username AS usuario, ca.numero AS "cajaNumero",
            v.motivo_anulacion AS "motivoAnulacion", v.anulada_en AS "anuladaEn",
            (SELECT username FROM usuario WHERE id = v.anulada_por) AS "anuladaPor"
       FROM venta v
       JOIN colegio co ON co.id = v.colegio_id
       JOIN persona pc ON pc.id = v.cliente_id
       LEFT JOIN grado g ON g.id = v.grado_id
       LEFT JOIN usuario us ON us.id = v.usuario_id
       LEFT JOIN turno_caja t ON t.id = v.turno_id LEFT JOIN caja ca ON ca.id = t.caja_id
      WHERE v.id = $1`,
    [id],
  );
  if (!v) return null;
  const alumnos: AlumnoDeVenta[] = await m.query(
    `SELECT va.id, va.alumno_id AS "alumnoId", trim(a.nombres || ' ' || a.apellidos) AS nombre,
            va.grado_id AS "gradoId", g.nombre AS grado, va.licencia, va.descuento::text AS descuento,
            va.combo_id AS "comboId"
       FROM venta_alumno va JOIN alumno a ON a.id = va.alumno_id
       LEFT JOIN grado g ON g.id = va.grado_id
      WHERE va.venta_id = $1 ORDER BY va.orden, va.id`,
    [id],
  );
  const lineas = await m.query(
    `SELECT d.id, d.venta_alumno_id AS "ventaAlumnoId", d.libro_id AS "libroId", l.titulo, l.isbn,
            d.cantidad, d.cantidad_entregada AS "cantidadEntregada",
            d.precio_unitario AS "precioUnitario", d.subtotal, d.estado,
            d.colegio_origen_id AS "colegioOrigenId", co.nombre AS "colegioOrigen"
       FROM venta_detalle d JOIN libro l ON l.id = d.libro_id
       LEFT JOIN colegio co ON co.id = d.colegio_origen_id
      WHERE d.venta_id = $1 ORDER BY l.titulo, d.id`,
    [id],
  );
  const pagos = await m.query(
    `SELECT p.id, mp.codigo AS metodo, mp.nombre, p.medio, p.monto_base AS "montoBase",
            p.recargo_pct AS "recargoPct", p.recargo, p.monto_total AS "montoTotal",
            p.recibido, p.vuelto, p.referencia, p.anulado
       FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
      WHERE p.venta_id = $1 ORDER BY p.id`,
    [id],
  );
  const correos = await m.query(
    `SELECT id, destinatario, estado, intentos, creado_en AS "creadoEn", enviado_en AS "enviadoEn"
       FROM correo_saliente WHERE venta_id = $1 ORDER BY id DESC LIMIT 5`,
    [id],
  );
  return { ...v, alumnos, lineas, pagos, correos } as VentaCompleta;
}

export interface AlumnoDeVenta {
  id: number;
  alumnoId: number;
  nombre: string;
  gradoId: number | null;
  grado: string | null;
  licencia: string | null;
  descuento: string;
  comboId: number | null;
}

export interface LineaDeVenta {
  id: number;
  ventaAlumnoId: number | null;
  libroId: number;
  titulo: string;
  isbn: string | null;
  cantidad: number;
  cantidadEntregada: number;
  precioUnitario: string;
  subtotal: string;
  estado: string;
  colegioOrigen: string | null;
}

export interface VentaCompleta {
  id: number;
  codigo: string;
  colegioId: number;
  colegio: string;
  clienteId: number;
  cliente: string;
  nit: string;
  clienteTelefono: string | null;
  clienteCorreo: string | null;
  alumno: string | null;
  grado: string | null;
  subtotal: string;
  descuento: string;
  recargo: string;
  total: string;
  estadoPago: string;
  fecha: Date;
  usuarioId: number | null;
  usuario: string | null;
  cajaNumero: number | null;
  motivoAnulacion: string | null;
  alumnos: AlumnoDeVenta[];
  lineas: LineaDeVenta[];
  pagos: {
    id: number;
    nombre: string;
    montoTotal: string;
    recargo: string;
    recargoPct: string;
    referencia: string | null;
    recibido: string | null;
    vuelto: string | null;
    anulado: boolean;
  }[];
  correos: { id: number; destinatario: string; estado: string; enviadoEn: Date | null }[];
}

/** Datos del emisor que van en el comprobante (tabla parametro). */
export async function datosEmpresa(m: Consultor) {
  const filas: { clave: string; valor: string }[] = await m.query(
    `SELECT clave, valor FROM parametro WHERE clave = ANY($1)`,
    [
      [
        'nombre_empresa',
        'nit_empresa',
        'direccion_empresa',
        'telefono_empresa',
        'correo_empresa',
        'sitio_licencias',
        'pie_comprobante',
      ],
    ],
  );
  const p = Object.fromEntries(filas.map((f) => [f.clave, f.valor.trim()]));
  return {
    nombre: p.nombre_empresa || 'Intelecto',
    // "CF" es el valor de ejemplo del seed: no se imprime un NIT que no es real.
    nit: p.nit_empresa && p.nit_empresa.toUpperCase() !== 'CF' ? p.nit_empresa : null,
    direccion: p.direccion_empresa || null,
    telefono: p.telefono_empresa || null,
    correo: p.correo_empresa || null,
    sitioLicencias: p.sitio_licencias || null,
    pie: p.pie_comprobante || null,
  };
}
export type DatosEmpresa = Awaited<ReturnType<typeof datosEmpresa>>;
