import Decimal from 'decimal.js';
import { money } from '../../common/utils/money';

/** RN-08: efectivo esperado = fondo + efectivo de ventas − retiros + ingresos − reembolsos. */
export function efectivoEsperado(t: {
  fondoInicial: Decimal.Value;
  efectivoVentas: Decimal.Value;
  retiros: Decimal.Value;
  ingresos: Decimal.Value;
  reembolsos: Decimal.Value;
}): Decimal {
  return money(t.fondoInicial)
    .plus(money(t.efectivoVentas))
    .minus(money(t.retiros))
    .plus(money(t.ingresos))
    .minus(money(t.reembolsos));
}

/** RN-09: diferencia = contado − esperado; efectivo a entregar = contado − fondo inicial. */
export function cuadreEfectivo(
  contado: Decimal.Value,
  esperado: Decimal.Value,
  fondo: Decimal.Value,
) {
  const diferencia = money(contado).minus(money(esperado));
  return {
    diferencia: diferencia.toFixed(2),
    aEntregar: Decimal.max(money(contado).minus(money(fondo)), 0).toFixed(2),
    cuadra: diferencia.isZero(),
  };
}
