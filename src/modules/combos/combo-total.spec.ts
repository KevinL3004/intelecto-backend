import { calcularTotalCombo } from './combo-total';

describe('calcularTotalCombo', () => {
  it('suma precio × cantidad y resta el descuento', () => {
    const r = calcularTotalCombo(
      [
        { precio: '125.50', cantidad: 1 },
        { precio: '80.25', cantidad: 2 },
      ],
      '50',
    );
    expect(r).toEqual({ subtotal: '286.00', descuento: '50.00', total: '236.00', completo: true });
  });

  it('no permite total negativo', () => {
    expect(calcularTotalCombo([{ precio: '10', cantidad: 1 }], '25').total).toBe('0.00');
  });

  it('marca incompleto si falta un precio', () => {
    const r = calcularTotalCombo(
      [
        { precio: '10', cantidad: 1 },
        { precio: null, cantidad: 1 },
      ],
      0,
    );
    expect(r.completo).toBe(false);
    expect(r.subtotal).toBe('10.00');
  });

  it('combo vacío es incompleto', () => {
    expect(calcularTotalCombo([], 0).completo).toBe(false);
  });
});
