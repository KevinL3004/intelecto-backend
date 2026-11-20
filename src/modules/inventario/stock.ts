import { EntityManager } from 'typeorm';
import { money } from '../../common/utils/money';
import { TipoMovInv } from '../../database/entities';

export interface Existencia {
  existencia: number;
  reservado: number;
  disponible: number;
}

/** Estados de línea que esperan stock en su colegio. */
export const ESTADOS_PENDIENTES = [
  'PENDIENTE_TRASLADO',
  'PENDIENTE_PROVEEDOR',
  'EN_TRANSITO',
  'EN_PEDIDO',
] as const;

/**
 * Bloquea (SELECT … FOR UPDATE) las filas de inventario del colegio para esos libros.
 * Crea las filas que falten en 0 para que también queden bloqueadas.
 * Se ordena por libro_id para que dos cajas no se bloqueen mutuamente (deadlock).
 */
export async function bloquearStock(
  m: EntityManager,
  colegioId: number,
  libroIds: number[],
): Promise<Map<number, Existencia>> {
  const ids = [...new Set(libroIds)].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  await m.query(
    `INSERT INTO inventario (colegio_id, libro_id) SELECT $1, unnest($2::bigint[])
     ON CONFLICT (colegio_id, libro_id) DO NOTHING`,
    [colegioId, ids],
  );
  const filas: { libroId: number; existencia: number; reservado: number }[] = await m.query(
    `SELECT libro_id AS "libroId", existencia, reservado FROM inventario
      WHERE colegio_id = $1 AND libro_id = ANY($2::bigint[])
      ORDER BY libro_id FOR UPDATE`,
    [colegioId, ids],
  );
  return new Map(
    filas.map((f) => [
      f.libroId,
      { existencia: f.existencia, reservado: f.reservado, disponible: f.existencia - f.reservado },
    ]),
  );
}

/** Suma (o resta) existencia y reservado de una fila ya bloqueada. */
export async function moverStock(
  m: EntityManager,
  colegioId: number,
  libroId: number,
  delta: { existencia?: number; reservado?: number },
) {
  await m.query(
    `UPDATE inventario SET existencia = existencia + $3, reservado = reservado + $4, version = version + 1
      WHERE colegio_id = $1 AND libro_id = $2`,
    [colegioId, libroId, delta.existencia ?? 0, delta.reservado ?? 0],
  );
}

/** Kárdex: todo movimiento de inventario queda registrado con usuario y fecha. */
export async function kardex(
  m: EntityManager,
  mov: {
    colegioId: number;
    libroId: number;
    tipo: TipoMovInv;
    cantidad: number;
    referencia?: string | null;
    motivo?: string | null;
    usuarioId: number;
  },
) {
  await m.query(
    `INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      mov.colegioId,
      mov.libroId,
      mov.tipo,
      mov.cantidad,
      mov.referencia ?? null,
      mov.motivo ?? null,
      mov.usuarioId,
    ],
  );
}

/**
 * RN-14: al entrar stock a un colegio, reserva para las ventas pendientes de ese libro
 * en orden de fecha de venta (FIFO). Si alcanza solo para parte de una línea, la parte:
 * lo que alcanza queda RESERVADO y el resto sigue pendiente.
 * Devuelve cuántas unidades se reservaron.
 */
export async function asignarFifo(
  m: EntityManager,
  colegioId: number,
  libroIds: number[],
  usuarioId: number,
): Promise<number> {
  let total = 0;
  const stock = await bloquearStock(m, colegioId, libroIds);
  for (const [libroId, s] of stock) {
    let disponible = s.disponible;
    if (disponible <= 0) continue;
    const pendientes: {
      id: number;
      ventaId: number;
      codigo: string;
      cantidad: number;
      precio: string;
    }[] = await m.query(
      `SELECT d.id, d.venta_id AS "ventaId", v.codigo, d.cantidad, d.precio_unitario AS precio
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
        WHERE v.colegio_id = $1 AND d.libro_id = $2 AND d.estado = ANY($3::estado_linea[])
          AND v.estado_pago = 'PAGADA'
        ORDER BY v.fecha, d.id
        FOR UPDATE OF d`,
      [colegioId, libroId, ESTADOS_PENDIENTES],
    );
    for (const p of pendientes) {
      if (disponible <= 0) break;
      const asignar = Math.min(disponible, p.cantidad);
      if (asignar === p.cantidad) {
        await m.query(
          `UPDATE venta_detalle SET estado = 'RESERVADO', colegio_origen_id = NULL WHERE id = $1`,
          [p.id],
        );
      } else {
        const resto = p.cantidad - asignar;
        await m.query(`UPDATE venta_detalle SET cantidad = $2, subtotal = $3 WHERE id = $1`, [
          p.id,
          resto,
          money(p.precio).mul(resto).toFixed(2),
        ]);
        await m.query(
          `INSERT INTO venta_detalle (venta_id, libro_id, cantidad, precio_unitario, subtotal, estado)
           VALUES ($1, $2, $3, $4, $5, 'RESERVADO')`,
          [p.ventaId, libroId, asignar, p.precio, money(p.precio).mul(asignar).toFixed(2)],
        );
      }
      await moverStock(m, colegioId, libroId, { reservado: asignar });
      await kardex(m, {
        colegioId,
        libroId,
        tipo: 'RESERVA',
        cantidad: asignar,
        referencia: p.codigo,
        motivo: 'Asignación automática a venta pendiente (FIFO)',
        usuarioId,
      });
      disponible -= asignar;
      total += asignar;
    }
  }
  return total;
}
