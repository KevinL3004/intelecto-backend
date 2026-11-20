import { calcularRecargo, calcularVuelto, totalConteo, toMoneyString } from './money';

describe('money', () => {
  it('calcula recargo del ejemplo del documento (Q500 al 5% = Q25.00)', () => {
    expect(calcularRecargo('500', '5').toFixed(2)).toBe('25.00');
  });
  it('redondea medio hacia arriba', () => {
    expect(calcularRecargo('10.10', '5').toFixed(2)).toBe('0.51'); // 0.505
  });
  it('evita errores de float', () => {
    expect(toMoneyString('0.1')).toBe('0.10');
    expect(calcularRecargo('0.30', '100').toFixed(2)).toBe('0.30');
  });
  it('calcula vuelto', () => {
    expect(calcularVuelto('800', '750').toFixed(2)).toBe('50.00');
  });
  it('rechaza monto insuficiente', () => {
    expect(() => calcularVuelto('700', '750')).toThrow('MONTO_INSUFICIENTE');
  });
  it('suma conteo por denominación', () => {
    const t = totalConteo([
      { valor: '200', cantidad: 2 },
      { valor: '0.25', cantidad: 3 },
      { valor: '0.05', cantidad: 1 },
    ]);
    expect(t.toFixed(2)).toBe('400.80');
  });
});
