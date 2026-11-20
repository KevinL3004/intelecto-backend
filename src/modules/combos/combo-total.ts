import Decimal from 'decimal.js';
import { money } from '../../common/utils/money';

export interface LineaCombo {
  precio: string | null;
  cantidad: number;
}

export interface TotalCombo {
  subtotal: string;
  descuento: string;
  total: string;
  /** false si algún libro no tiene precio en el colegio/ciclo del combo. */
  completo: boolean;
}

/** Precio del combo = Σ(precio × cantidad) − descuento, nunca negativo. */
export function calcularTotalCombo(lineas: LineaCombo[], descuento: Decimal.Value): TotalCombo {
  const subtotal = lineas.reduce(
    (acc, l) => acc.plus(money(l.precio ?? 0).mul(l.cantidad)),
    new Decimal(0),
  );
  const d = money(descuento);
  const total = Decimal.max(subtotal.minus(d), 0);
  return {
    subtotal: subtotal.toFixed(2),
    descuento: d.toFixed(2),
    total: total.toFixed(2),
    completo: lineas.length > 0 && lineas.every((l) => l.precio !== null),
  };
}
