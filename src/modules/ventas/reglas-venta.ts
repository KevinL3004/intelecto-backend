import Decimal from 'decimal.js';
import { calcularRecargo, money } from '../../common/utils/money';

/** Método de pago con el recargo VIGENTE leído de la BD al momento de cobrar (RN-01). */
export interface MetodoVigente {
  id: number;
  codigo: string;
  nombre: string;
  recargoPct: string;
  requiereReferencia: boolean;
}

export interface PagoEntrada {
  metodoPagoId: number;
  montoBase: string;
  /** Solo efectivo: lo que entrega el cliente. Si no viene, se asume el monto exacto. */
  recibido?: string | null;
  referencia?: string | null;
  medio?: 'TERMINAL' | 'LINK_PAGO' | 'OTRO' | null;
  /** Recargo que vio el cajero; si ya no es el vigente se avisa (RECARGO_CAMBIO). */
  recargoPct?: string | null;
}

export interface PagoCalculado {
  metodoPagoId: number;
  codigo: string;
  nombre: string;
  montoBase: string;
  recargoPct: string;
  recargo: string;
  montoTotal: string;
  recibido: string | null;
  vuelto: string | null;
  referencia: string | null;
  medio: PagoEntrada['medio'];
}

export interface ErrorRegla {
  error: string;
  message: string;
}

export interface ResultadoPagos {
  pagos: PagoCalculado[];
  /** Σ montos base (debe ser igual a lo que hay que pagar). */
  base: string;
  recargo: string;
  /** Lo que se cobra en total: base + recargos (RN-02). */
  total: string;
  /** Positivo = falta pagar; negativo = se pagó de más. */
  faltante: string;
  vuelto: string;
  errores: ErrorRegla[];
}

/**
 * RN-01/02/06/07/20: calcula recargos por pago, vuelto y verifica que cuadre.
 * No lanza: devuelve la lista de errores para que la cotización los muestre.
 */
export function calcularPagos(
  entradas: PagoEntrada[],
  metodos: Map<number, MetodoVigente>,
  aPagar: Decimal.Value,
): ResultadoPagos {
  const errores: ErrorRegla[] = [];
  let base = new Decimal(0);
  let recargo = new Decimal(0);
  let vuelto = new Decimal(0);

  const pagos = entradas.map((p): PagoCalculado => {
    const m = metodos.get(p.metodoPagoId);
    const montoBase = money(p.montoBase);
    if (!m) {
      errores.push({ error: 'METODO_INVALIDO', message: 'Método de pago no disponible' });
      return vacio(p, montoBase);
    }
    if (montoBase.lte(0))
      errores.push({
        error: 'MONTO_INVALIDO',
        message: `El monto en ${m.nombre} debe ser mayor a 0`,
      });
    if (p.recargoPct != null && !new Decimal(p.recargoPct).eq(m.recargoPct))
      errores.push({
        error: 'RECARGO_CAMBIO',
        message: `El recargo de ${m.nombre} cambió a ${m.recargoPct} %. Revise el monto a cobrar.`,
      });
    const ref = p.referencia?.trim() || null;
    if (m.requiereReferencia && !ref)
      errores.push({
        error: 'REFERENCIA_REQUERIDA',
        message: `Ingrese la referencia o autorización del pago con ${m.nombre}`,
      });

    const r = calcularRecargo(montoBase, m.recargoPct);
    const total = montoBase.plus(r);
    let recibido: Decimal | null = null;
    let v: Decimal | null = null;
    if (m.codigo === 'EFECTIVO') {
      recibido = p.recibido != null && p.recibido !== '' ? money(p.recibido) : total;
      if (recibido.lt(total))
        errores.push({
          error: 'MONTO_INSUFICIENTE',
          message: `El efectivo recibido (Q${recibido.toFixed(2)}) no cubre Q${total.toFixed(2)}`,
        });
      else v = recibido.minus(total);
    }
    base = base.plus(montoBase);
    recargo = recargo.plus(r);
    vuelto = vuelto.plus(v ?? 0);
    return {
      metodoPagoId: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      montoBase: montoBase.toFixed(2),
      recargoPct: new Decimal(m.recargoPct).toFixed(2),
      recargo: r.toFixed(2),
      montoTotal: total.toFixed(2),
      recibido: recibido?.toFixed(2) ?? null,
      vuelto: v?.toFixed(2) ?? null,
      referencia: ref,
      medio: m.codigo === 'TARJETA' ? (p.medio ?? null) : null,
    };
  });

  const faltante = money(aPagar).minus(base);
  if (!faltante.isZero())
    errores.push({
      error: 'PAGOS_NO_CUADRAN',
      message: faltante.isPositive()
        ? `Faltan Q${faltante.toFixed(2)} por cubrir`
        : `Los pagos exceden el total por Q${faltante.abs().toFixed(2)}`,
    });

  return {
    pagos,
    base: base.toFixed(2),
    recargo: recargo.toFixed(2),
    total: base.plus(recargo).toFixed(2),
    faltante: faltante.toFixed(2),
    vuelto: vuelto.toFixed(2),
    errores,
  };
}

function vacio(p: PagoEntrada, montoBase: Decimal): PagoCalculado {
  return {
    metodoPagoId: p.metodoPagoId,
    codigo: '',
    nombre: '',
    montoBase: montoBase.toFixed(2),
    recargoPct: '0.00',
    recargo: '0.00',
    montoTotal: montoBase.toFixed(2),
    recibido: null,
    vuelto: null,
    referencia: null,
    medio: null,
  };
}

/** Parte la cantidad pedida entre lo que hay disponible y lo que queda pendiente. */
export function repartir(cantidad: number, disponible: number) {
  const conStock = Math.max(0, Math.min(cantidad, disponible));
  return { conStock, sinStock: cantidad - conStock };
}

export type EstadoLinea =
  | 'PENDIENTE_PROVEEDOR'
  | 'EN_PEDIDO'
  | 'PENDIENTE_TRASLADO'
  | 'EN_TRANSITO'
  | 'RESERVADO'
  | 'ENTREGADO'
  | 'ANULADO';

/** Estado resumen de la venta a partir de sus líneas (las anuladas no cuentan). */
export function estadoEntrega(
  lineas: { estado: EstadoLinea; cantidad: number; cantidadEntregada: number }[],
): 'PENDIENTE' | 'PARCIAL' | 'COMPLETA' {
  const vivas = lineas.filter((l) => l.estado !== 'ANULADO');
  if (vivas.length && vivas.every((l) => l.estado === 'ENTREGADO')) return 'COMPLETA';
  return vivas.some((l) => l.cantidadEntregada > 0) ? 'PARCIAL' : 'PENDIENTE';
}

/** El combo aplica descuento solo si la venta trae todos sus libros en la cantidad del combo. */
export function comboCompleto(
  combo: { libroId: number; cantidad: number }[],
  lineas: { libroId: number; cantidad: number }[],
) {
  const porLibro = new Map<number, number>();
  for (const l of lineas) porLibro.set(l.libroId, (porLibro.get(l.libroId) ?? 0) + l.cantidad);
  return combo.length > 0 && combo.every((c) => (porLibro.get(c.libroId) ?? 0) >= c.cantidad);
}
