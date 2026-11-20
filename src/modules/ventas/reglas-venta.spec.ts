import {
  calcularPagos,
  comboCompleto,
  EstadoLinea,
  estadoEntrega,
  MetodoVigente,
  repartir,
} from './reglas-venta';

const metodos = new Map<number, MetodoVigente>([
  [
    1,
    {
      id: 1,
      codigo: 'EFECTIVO',
      nombre: 'Efectivo',
      recargoPct: '0.00',
      requiereReferencia: false,
    },
  ],
  [
    2,
    { id: 2, codigo: 'TARJETA', nombre: 'Tarjeta', recargoPct: '5.00', requiereReferencia: true },
  ],
  [
    3,
    {
      id: 3,
      codigo: 'TRANSFERENCIA',
      nombre: 'Transferencia',
      recargoPct: '0.00',
      requiereReferencia: true,
    },
  ],
]);

describe('calcularPagos', () => {
  it('ejemplo 6.1 del documento: mixto efectivo + tarjeta 5 %', () => {
    const r = calcularPagos(
      [
        { metodoPagoId: 1, montoBase: '750', recibido: '800' },
        { metodoPagoId: 2, montoBase: '500', referencia: 'AUT-123', recargoPct: '5' },
      ],
      metodos,
      '1250',
    );
    expect(r.errores).toEqual([]);
    expect(r.recargo).toBe('25.00');
    expect(r.total).toBe('1275.00');
    expect(r.vuelto).toBe('50.00');
    expect(r.pagos[1].montoTotal).toBe('525.00');
  });

  it('recargo redondeado a 2 decimales (RN-02)', () => {
    const r = calcularPagos(
      [{ metodoPagoId: 2, montoBase: '123.45', referencia: 'x' }],
      metodos,
      '123.45',
    );
    expect(r.recargo).toBe('6.17'); // 6.1725
  });

  it('efectivo insuficiente (RN-06)', () => {
    const r = calcularPagos(
      [{ metodoPagoId: 1, montoBase: '100', recibido: '90' }],
      metodos,
      '100',
    );
    expect(r.errores.map((e) => e.error)).toContain('MONTO_INSUFICIENTE');
  });

  it('los pagos deben cuadrar con el total (RN-07)', () => {
    const r = calcularPagos([{ metodoPagoId: 1, montoBase: '90' }], metodos, '100');
    expect(r.faltante).toBe('10.00');
    expect(r.errores.map((e) => e.error)).toContain('PAGOS_NO_CUADRAN');
  });

  it('tarjeta y transferencia exigen referencia (RN-20)', () => {
    const r = calcularPagos([{ metodoPagoId: 3, montoBase: '100' }], metodos, '100');
    expect(r.errores.map((e) => e.error)).toEqual(['REFERENCIA_REQUERIDA']);
  });

  it('avisa si el recargo cambió mientras se cobraba (CU-05 A2)', () => {
    const r = calcularPagos(
      [{ metodoPagoId: 2, montoBase: '100', referencia: 'x', recargoPct: '3' }],
      metodos,
      '100',
    );
    expect(r.errores.map((e) => e.error)).toEqual(['RECARGO_CAMBIO']);
  });

  it('efectivo sin "recibido" se toma exacto, sin vuelto', () => {
    const r = calcularPagos([{ metodoPagoId: 1, montoBase: '100' }], metodos, '100');
    expect(r.pagos[0].recibido).toBe('100.00');
    expect(r.vuelto).toBe('0.00');
  });
});

describe('repartir', () => {
  it('parte entre stock y pendiente', () => {
    expect(repartir(3, 1)).toEqual({ conStock: 1, sinStock: 2 });
    expect(repartir(2, 5)).toEqual({ conStock: 2, sinStock: 0 });
    expect(repartir(2, -1)).toEqual({ conStock: 0, sinStock: 2 });
  });
});

describe('estadoEntrega', () => {
  const l = (estado: EstadoLinea, cantidad: number, cantidadEntregada: number) => ({
    estado,
    cantidad,
    cantidadEntregada,
  });
  it('COMPLETA si todo lo vigente está entregado', () =>
    expect(estadoEntrega([l('ENTREGADO', 1, 1), l('ANULADO', 1, 0)])).toBe('COMPLETA'));
  it('PARCIAL si algo se entregó', () =>
    expect(estadoEntrega([l('ENTREGADO', 1, 1), l('RESERVADO', 1, 0)])).toBe('PARCIAL'));
  it('PENDIENTE si nada se entregó', () =>
    expect(estadoEntrega([l('RESERVADO', 1, 0), l('PENDIENTE_PROVEEDOR', 2, 0)])).toBe(
      'PENDIENTE',
    ));
});

describe('comboCompleto', () => {
  const combo = [
    { libroId: 1, cantidad: 1 },
    { libroId: 2, cantidad: 2 },
  ];
  it('completo con todos los libros', () =>
    expect(
      comboCompleto(combo, [
        { libroId: 1, cantidad: 1 },
        { libroId: 2, cantidad: 2 },
        { libroId: 9, cantidad: 1 },
      ]),
    ).toBe(true));
  it('incompleto si el cliente quita un libro', () =>
    expect(
      comboCompleto(combo, [
        { libroId: 1, cantidad: 1 },
        { libroId: 2, cantidad: 1 },
      ]),
    ).toBe(false));
});
