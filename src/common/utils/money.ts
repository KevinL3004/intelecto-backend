import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Todo cálculo de dinero pasa por aquí. Nunca usar number/float para montos. */
export const money = (v: Decimal.Value) => new Decimal(v || 0).toDecimalPlaces(2);

export const toMoneyString = (v: Decimal.Value) => money(v).toFixed(2);

/** RN-02: recargo = base × pct / 100, redondeado a 2 decimales. */
export function calcularRecargo(base: Decimal.Value, pct: Decimal.Value): Decimal {
  return new Decimal(base).mul(pct).div(100).toDecimalPlaces(2);
}

/** RN-06: vuelto = recibido − monto. Lanza si no alcanza. */
export function calcularVuelto(recibido: Decimal.Value, monto: Decimal.Value): Decimal {
  const v = money(recibido).minus(money(monto));
  if (v.isNegative()) throw new Error('MONTO_INSUFICIENTE');
  return v;
}

/** Suma un conteo por denominación: [{ valor: '200', cantidad: 3 }, ...] */
export function totalConteo(items: { valor: Decimal.Value; cantidad: number }[]): Decimal {
  return items
    .reduce((acc, i) => acc.plus(new Decimal(i.valor).mul(i.cantidad)), new Decimal(0))
    .toDecimalPlaces(2);
}
