/**
 * Cálculos de análisis (funciones puras, con pruebas): pronóstico de ventas y abastecimiento.
 * Se mantienen simples y explicables: el contador debe poder entender de dónde sale cada número.
 */

export interface PuntoSerie {
  /** YYYY-MM-DD */
  dia: string;
  valor: number;
}
export interface PuntoPronostico {
  dia: string;
  esperado: number;
  min: number;
  max: number;
}

/** z para un intervalo central del 80 %. */
const Z80 = 1.2816;
const r2 = (n: number) => Math.round(n * 100) / 100;
const diaSemana = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const sumarDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Pronóstico = tendencia lineal × factor del día de la semana; intervalo del 80 % a partir del
 * error del ajuste. Con menos de 14 días de historia no se pronostica (sería adivinar).
 */
export function pronosticar(serie: PuntoSerie[], horizonte: number) {
  const n = serie.length;
  if (n < 14) return { puntos: [] as PuntoPronostico[], tendenciaSemanalPct: null, error: null };

  // Regresión lineal (mínimos cuadrados) sobre el índice del día.
  const xs = serie.map((_, i) => i);
  const ys = serie.map((p) => p.valor);
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const tendencia = (x: number) => Math.max(a + b * x, my * 0.05, 0.01);

  // Factor por día de la semana: cuánto se vende ese día respecto de la tendencia.
  const acum = Array.from({ length: 7 }, () => ({ s: 0, c: 0 }));
  serie.forEach((p, i) => {
    const f = acum[diaSemana(p.dia)];
    f.s += p.valor / tendencia(i);
    f.c++;
  });
  const factor = acum.map((f) => (f.c ? f.s / f.c : 1));

  // Error típico del ajuste (residuos).
  let ss = 0;
  serie.forEach((p, i) => {
    ss += (p.valor - tendencia(i) * factor[diaSemana(p.dia)]) ** 2;
  });
  const sigma = Math.sqrt(ss / Math.max(n - 2, 1));

  const ultimo = serie[n - 1].dia;
  const puntos: PuntoPronostico[] = [];
  for (let h = 1; h <= horizonte; h++) {
    const dia = sumarDias(ultimo, h);
    const f = factor[diaSemana(dia)];
    const esperado = Math.max(0, tendencia(n - 1 + h) * f);
    // El margen escala con el día (un domingo cerrado no tiene margen) y crece con el horizonte.
    const margen = Z80 * sigma * Math.min(f, 1.5) * Math.sqrt(1 + h / n);
    puntos.push({
      dia,
      esperado: r2(esperado),
      min: r2(Math.max(0, esperado - margen)),
      max: r2(esperado + margen),
    });
  }
  return {
    puntos,
    /** Crecimiento semanal de la tendencia, en % del promedio diario. */
    tendenciaSemanalPct: my > 0 ? r2(((b * 7) / my) * 100) : null,
    /** Error típico diario (Q). */
    error: r2(sigma),
  };
}

// ---------------------------------------------------------------------------------------------
// Abastecimiento

export interface FilaStock {
  colegioId: number;
  colegio: string;
  libroId: number;
  titulo: string;
  editorial: string | null;
  /** existencia − reservado */
  disponible: number;
  /** Unidades vendidas esperando stock propio (pendiente de traslado o de proveedor). */
  pendientes: number;
  /** Unidades que ya vienen (traslado en tránsito o pedido al proveedor). */
  enCamino: number;
  vendidos7: number;
  vendidos28: number;
}

export type Riesgo = 'CRITICO' | 'ALTO' | 'MEDIO' | 'OK';

export interface FilaCobertura extends FilaStock {
  demandaDiaria: number;
  /** Días que alcanza lo disponible (tras atender lo pendiente) al ritmo actual; null sin demanda. */
  diasCobertura: number | null;
  /** Unidades que faltan para atender lo pendiente y la demanda del horizonte. */
  faltante: number;
  /** Lo que este colegio puede ceder sin quedarse corto en el horizonte. */
  excedente: number;
  riesgo: Riesgo;
}

export interface Sugerencia {
  tipo: 'TRASLADO' | 'PEDIDO';
  libroId: number;
  titulo: string;
  editorial: string | null;
  destinoId: number;
  destino: string;
  origenId: number | null;
  origen: string | null;
  cantidad: number;
  riesgo: Riesgo;
  motivo: string;
}

const ORDEN_RIESGO: Record<Riesgo, number> = { CRITICO: 0, ALTO: 1, MEDIO: 2, OK: 3 };

/**
 * Cobertura por colegio y libro. Demanda diaria = 60 % ritmo de la última semana + 40 % de las
 * últimas cuatro (reacciona a la temporada sin exagerar un día atípico).
 */
export function cobertura(filas: FilaStock[], horizonteDias = 14): FilaCobertura[] {
  return filas.map((f) => {
    const demandaDiaria = r2(0.6 * (f.vendidos7 / 7) + 0.4 * (f.vendidos28 / 28));
    const demandaH = Math.ceil(demandaDiaria * horizonteDias);
    const libre = f.disponible - f.pendientes;
    const faltante = Math.max(0, f.pendientes + demandaH - f.disponible - f.enCamino);
    const excedente = Math.max(0, f.disponible - f.pendientes - demandaH);
    const diasCobertura = demandaDiaria > 0 ? r2(Math.max(0, libre) / demandaDiaria) : null;
    let riesgo: Riesgo = 'OK';
    if (f.pendientes > f.enCamino || (diasCobertura !== null && diasCobertura < 3 && faltante > 0))
      riesgo = 'CRITICO';
    else if (faltante > 0 && diasCobertura !== null && diasCobertura < 7) riesgo = 'ALTO';
    else if (faltante > 0) riesgo = 'MEDIO';
    return { ...f, demandaDiaria, diasCobertura, faltante, excedente, riesgo };
  });
}

/**
 * Sugerencias: para cada colegio con faltante, primero traslados desde colegios con excedente
 * (el de mayor excedente primero, sin dejarlo corto); lo que no alcanza, pedido al proveedor.
 */
export function sugerir(filas: FilaCobertura[]): Sugerencia[] {
  const sugerencias: Sugerencia[] = [];
  const porLibro = new Map<number, FilaCobertura[]>();
  for (const f of filas) porLibro.set(f.libroId, [...(porLibro.get(f.libroId) ?? []), f]);

  for (const grupo of porLibro.values()) {
    const sobra = new Map(grupo.map((f) => [f.colegioId, f.excedente]));
    const necesitan = grupo
      .filter((f) => f.faltante > 0)
      .sort((a, b) => ORDEN_RIESGO[a.riesgo] - ORDEN_RIESGO[b.riesgo] || b.faltante - a.faltante);
    for (const d of necesitan) {
      let resta = d.faltante;
      const origenes = grupo
        .filter((o) => o.colegioId !== d.colegioId && (sobra.get(o.colegioId) ?? 0) > 0)
        .sort((a, b) => (sobra.get(b.colegioId) ?? 0) - (sobra.get(a.colegioId) ?? 0));
      for (const o of origenes) {
        if (resta <= 0) break;
        const q = Math.min(resta, sobra.get(o.colegioId) ?? 0);
        sobra.set(o.colegioId, (sobra.get(o.colegioId) ?? 0) - q);
        resta -= q;
        sugerencias.push({
          tipo: 'TRASLADO',
          libroId: d.libroId,
          titulo: d.titulo,
          editorial: d.editorial,
          destinoId: d.colegioId,
          destino: d.colegio,
          origenId: o.colegioId,
          origen: o.colegio,
          cantidad: q,
          riesgo: d.riesgo,
          motivo: motivo(d, `${o.colegio} tiene excedente`),
        });
      }
      if (resta > 0)
        sugerencias.push({
          tipo: 'PEDIDO',
          libroId: d.libroId,
          titulo: d.titulo,
          editorial: d.editorial,
          destinoId: d.colegioId,
          destino: d.colegio,
          origenId: null,
          origen: null,
          cantidad: resta,
          riesgo: d.riesgo,
          motivo: motivo(d, 'ningún colegio tiene excedente suficiente'),
        });
    }
  }
  return sugerencias.sort(
    (a, b) => ORDEN_RIESGO[a.riesgo] - ORDEN_RIESGO[b.riesgo] || b.cantidad - a.cantidad,
  );
}

function motivo(d: FilaCobertura, fuente: string) {
  const partes: string[] = [];
  if (d.pendientes) partes.push(`${d.pendientes} vendido(s) esperando`);
  if (d.diasCobertura !== null)
    partes.push(
      d.diasCobertura < 1
        ? 'sin existencia para nuevas ventas'
        : `alcanza para ~${Math.floor(d.diasCobertura)} día(s)`,
    );
  if (d.enCamino) partes.push(`${d.enCamino} en camino`);
  return `${partes.join(', ')}; ${fuente}`;
}
