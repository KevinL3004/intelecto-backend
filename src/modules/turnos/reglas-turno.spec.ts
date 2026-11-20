import { cuadreEfectivo, efectivoEsperado } from './reglas-turno';

describe('reglas de turno', () => {
  it('efectivo esperado (RN-08)', () => {
    const e = efectivoEsperado({
      fondoInicial: '500',
      efectivoVentas: '1250.50',
      retiros: '1000',
      ingresos: '100',
      reembolsos: '150.25',
    });
    expect(e.toFixed(2)).toBe('700.25');
  });

  it('diferencia y efectivo a entregar (RN-09)', () => {
    expect(cuadreEfectivo('690.25', '700.25', '500')).toEqual({
      diferencia: '-10.00',
      aEntregar: '190.25',
      cuadra: false,
    });
    expect(cuadreEfectivo('700.25', '700.25', '500').cuadra).toBe(true);
  });
});
