import { cobertura, FilaStock, pronosticar, sugerir } from './analitica';

const serie = (dias: number, f: (i: number, dow: number) => number) => {
  const inicio = new Date('2026-09-01T12:00:00Z'); // martes
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(inicio);
    d.setUTCDate(d.getUTCDate() + i);
    return { dia: d.toISOString().slice(0, 10), valor: f(i, d.getUTCDay()) };
  });
};

describe('pronosticar', () => {
  it('sin historia suficiente no pronostica', () => {
    expect(
      pronosticar(
        serie(10, () => 100),
        7,
      ).puntos,
    ).toEqual([]);
  });

  it('serie constante: pronóstico plano y margen casi nulo', () => {
    const r = pronosticar(
      serie(28, () => 1000),
      7,
    );
    expect(r.puntos).toHaveLength(7);
    for (const p of r.puntos) {
      expect(p.esperado).toBeCloseTo(1000, 0);
      expect(p.max - p.min).toBeLessThan(1);
    }
    expect(r.tendenciaSemanalPct).toBeCloseTo(0, 5);
  });

  it('respeta los domingos cerrados y la tendencia creciente', () => {
    const r = pronosticar(
      serie(42, (i, dow) => (dow === 0 ? 0 : 500 + 20 * i)),
      14,
    );
    const domingos = r.puntos.filter((p) => new Date(p.dia + 'T12:00:00Z').getUTCDay() === 0);
    expect(domingos.length).toBeGreaterThan(0);
    for (const d of domingos) expect(d.esperado).toBe(0);
    const habiles = r.puntos.filter((p) => p.esperado > 0);
    expect(habiles[habiles.length - 1].esperado).toBeGreaterThan(habiles[0].esperado);
    expect(r.tendenciaSemanalPct!).toBeGreaterThan(0);
    for (const p of r.puntos) expect(p.min).toBeLessThanOrEqual(p.esperado);
  });
});

const fila = (x: Partial<FilaStock>): FilaStock => ({
  colegioId: 1,
  colegio: 'Norte',
  libroId: 10,
  titulo: 'Inglés 2',
  editorial: 'Oxford',
  disponible: 0,
  pendientes: 0,
  enCamino: 0,
  vendidos7: 0,
  vendidos28: 0,
  ...x,
});

describe('cobertura y sugerencias', () => {
  it('calcula demanda, días de cobertura y riesgo', () => {
    const [c] = cobertura([fila({ disponible: 20, vendidos7: 14, vendidos28: 28 })], 14);
    // 0.6×2 + 0.4×1 = 1.6/día → 20/1.6 = 12.5 días; faltan 23 − 20 = 3 para 14 días
    expect(c.demandaDiaria).toBe(1.6);
    expect(c.diasCobertura).toBe(12.5);
    expect(c.faltante).toBe(3);
    expect(c.riesgo).toBe('MEDIO');
  });

  it('clientes esperando sin nada en camino → CRÍTICO', () => {
    const [c] = cobertura([fila({ pendientes: 4 })]);
    expect(c.riesgo).toBe('CRITICO');
    expect(c.faltante).toBe(4);
  });

  it('lo que ya viene en camino cubre lo pendiente', () => {
    const [c] = cobertura([fila({ pendientes: 4, enCamino: 4 })]);
    expect(c.faltante).toBe(0);
    expect(c.riesgo).toBe('OK');
  });

  it('traslada desde el excedente y pide al proveedor el resto', () => {
    const filas = cobertura([
      fila({ colegioId: 1, colegio: 'Sur', pendientes: 10 }),
      fila({ colegioId: 2, colegio: 'Norte', disponible: 30, vendidos7: 7, vendidos28: 28 }), // 1/día: necesita 14, sobra 16
      fila({ colegioId: 3, colegio: 'Central', disponible: 2 }),
    ]);
    const s = sugerir(filas);
    const t = s.find((x) => x.tipo === 'TRASLADO')!;
    expect(t).toMatchObject({ origen: 'Norte', destino: 'Sur', cantidad: 10, riesgo: 'CRITICO' });
    expect(s.some((x) => x.tipo === 'PEDIDO')).toBe(false);

    const s2 = sugerir(
      cobertura([
        fila({ colegioId: 1, colegio: 'Sur', pendientes: 20 }),
        fila({ colegioId: 2, colegio: 'Norte', disponible: 30, vendidos7: 7, vendidos28: 28 }),
      ]),
    );
    expect(s2.find((x) => x.tipo === 'TRASLADO')!.cantidad).toBe(16);
    expect(s2.find((x) => x.tipo === 'PEDIDO')).toMatchObject({ destino: 'Sur', cantidad: 4 });
  });

  it('no deja corto al colegio de origen', () => {
    const s = sugerir(
      cobertura([
        fila({ colegioId: 1, colegio: 'Sur', pendientes: 5 }),
        fila({ colegioId: 2, colegio: 'Norte', disponible: 10, vendidos7: 7, vendidos28: 28 }),
      ]),
    );
    // Norte necesita 14 en dos semanas y solo tiene 10: no puede ceder (y también debe pedir 4).
    expect(s.some((x) => x.tipo === 'TRASLADO')).toBe(false);
    expect(s).toContainEqual(
      expect.objectContaining({ tipo: 'PEDIDO', destino: 'Sur', cantidad: 5 }),
    );
    expect(s).toContainEqual(
      expect.objectContaining({ tipo: 'PEDIDO', destino: 'Norte', cantidad: 4 }),
    );
  });
});
