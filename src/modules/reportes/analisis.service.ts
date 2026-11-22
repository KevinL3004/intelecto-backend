import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { cobertura, FilaStock, pronosticar, sugerir, Sugerencia } from './analitica';

const TZ = `'America/Guatemala'`;
const HOY = `(now() AT TIME ZONE ${TZ})::date`;
/** Fecha local (Guatemala) de una columna timestamptz. */
const DIA = (col: string) => `(${col} AT TIME ZONE ${TZ})::date`;
const HORIZONTE = 14;

export interface Alerta {
  nivel: 'CRITICO' | 'ALTO' | 'MEDIO' | 'INFO';
  titulo: string;
  detalle: string;
  /** Pestaña o pantalla donde se resuelve. */
  accion?: 'abastecimiento' | 'pendientes' | 'cuadres' | 'pedidos' | 'traslados';
}

const n = (v: unknown) => Number(v ?? 0);
const q2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const variacion = (actual: number, anterior: number) =>
  anterior > 0 ? Math.round(((actual - anterior) / anterior) * 1000) / 10 : null;

/** Análisis para la toma de decisiones (Admin/Contador): tendencias, pronóstico y abastecimiento. */
@Injectable()
export class AnalisisService {
  constructor(private readonly ds: DataSource) {}

  async analisis(dias: number, colegioId?: number) {
    const col = colegioId ?? null;
    const p = [col, dias];
    const ventaEn = `($1::bigint IS NULL OR v.colegio_id = $1)`;
    const enPeriodo = (c: string) => `${DIA(c)} > ${HOY} - $2::int AND ${DIA(c)} <= ${HOY}`;
    const enAnterior = (c: string) =>
      `${DIA(c)} > ${HOY} - 2 * $2::int AND ${DIA(c)} <= ${HOY} - $2::int`;

    // ---------- Serie diaria e indicadores ----------
    const serie: { dia: string; total: string; ventas: number }[] = await this.ds.query(
      `SELECT to_char(g.d, 'YYYY-MM-DD') AS dia,
              coalesce(sum(v.total), 0)::numeric(12,2)::text AS total, count(v.id)::int AS ventas
         FROM generate_series(${HOY} - ($2::int - 1), ${HOY}, interval '1 day') AS g(d)
         LEFT JOIN venta v ON ${DIA('v.fecha')} = g.d::date AND v.estado_pago = 'PAGADA' AND ${ventaEn}
        GROUP BY g.d ORDER BY g.d`,
      p,
    );
    const kpi = async (rango: (c: string) => string) => {
      const [k] = await this.ds.query(
        `SELECT coalesce(sum(v.total) FILTER (WHERE v.estado_pago = 'PAGADA'), 0)::text AS ingresos,
                count(*) FILTER (WHERE v.estado_pago = 'PAGADA')::int AS ventas,
                coalesce(sum(v.recargo) FILTER (WHERE v.estado_pago = 'PAGADA'), 0)::text AS recargos,
                coalesce(sum(v.descuento) FILTER (WHERE v.estado_pago = 'PAGADA'), 0)::text AS descuentos,
                count(*) FILTER (WHERE v.estado_pago = 'ANULADA')::int AS anuladas,
                coalesce(sum(v.total) FILTER (WHERE v.estado_pago = 'ANULADA'), 0)::text AS "montoAnulado",
                (SELECT coalesce(sum(d.cantidad), 0) FROM venta_detalle d JOIN venta v2 ON v2.id = d.venta_id
                  WHERE v2.estado_pago = 'PAGADA' AND ${rango('v2.fecha')}
                    AND ($1::bigint IS NULL OR v2.colegio_id = $1))::int AS unidades,
                (SELECT count(*) FROM venta_alumno va JOIN venta v3 ON v3.id = va.venta_id
                  WHERE v3.estado_pago = 'PAGADA' AND ${rango('v3.fecha')}
                    AND ($1::bigint IS NULL OR v3.colegio_id = $1))::int AS alumnos
           FROM venta v WHERE ${ventaEn} AND ${rango('v.fecha')}`,
        p,
      );
      return k;
    };
    const [actual, anterior] = await Promise.all([kpi(enPeriodo), kpi(enAnterior)]);
    const ticket = (k: { ingresos: string; ventas: number }) =>
      k.ventas ? n(k.ingresos) / k.ventas : 0;
    const kpis = {
      ingresos: q2(n(actual.ingresos)),
      ingresosVar: variacion(n(actual.ingresos), n(anterior.ingresos)),
      ventas: actual.ventas,
      ventasVar: variacion(actual.ventas, anterior.ventas),
      ticketPromedio: q2(ticket(actual)),
      ticketVar: variacion(ticket(actual), ticket(anterior)),
      unidades: actual.unidades,
      alumnos: actual.alumnos,
      recargos: q2(n(actual.recargos)),
      descuentos: q2(n(actual.descuentos)),
      anuladas: actual.anuladas,
      montoAnulado: q2(n(actual.montoAnulado)),
    };

    // Pronóstico: se ajusta con días completos (hasta ayer) y se proyecta desde hoy.
    const completos = serie.slice(0, -1).map((s) => ({ dia: s.dia, valor: n(s.total) }));
    // Los días previos a la primera venta (antes de la temporada) no son "cero ventas": se omiten.
    const primero = completos.findIndex((x) => x.valor > 0);
    const historia = primero < 0 ? [] : completos.slice(primero);
    const pron = pronosticar(historia, HORIZONTE);
    const proyeccion = {
      dias: HORIZONTE,
      esperado: q2(pron.puntos.reduce((a, x) => a + x.esperado, 0)),
      // Suma de los extremos diarios: rango conservador (no es un intervalo del 80 % del total).
      min: q2(pron.puntos.reduce((a, x) => a + x.min, 0)),
      max: q2(pron.puntos.reduce((a, x) => a + x.max, 0)),
      tendenciaSemanalPct: pron.tendenciaSemanalPct,
      errorDiario: pron.error,
    };

    // ---------- Desgloses del período ----------
    const porColegio = await this.ds.query(
      `SELECT co.id, co.nombre AS colegio, coalesce(sum(v.total), 0)::numeric(12,2)::text AS ingresos,
              count(v.id)::int AS ventas,
              coalesce(round(avg(v.total), 2), 0)::text AS ticket
         FROM colegio co
         LEFT JOIN venta v ON v.colegio_id = co.id AND v.estado_pago = 'PAGADA' AND ${enPeriodo('v.fecha')}
        WHERE co.activo AND ($1::bigint IS NULL OR co.id = $1)
        GROUP BY co.id, co.nombre ORDER BY sum(v.total) DESC NULLS LAST`,
      p,
    );
    const porMetodo = await this.ds.query(
      `SELECT mp.nombre AS metodo, count(pg.id)::int AS pagos,
              coalesce(sum(pg.monto_base), 0)::numeric(12,2)::text AS base,
              coalesce(sum(pg.recargo), 0)::numeric(12,2)::text AS recargo,
              coalesce(sum(pg.monto_total), 0)::numeric(12,2)::text AS total
         FROM metodo_pago mp
         LEFT JOIN venta_pago pg ON pg.metodo_pago_id = mp.id AND NOT pg.anulado AND ${enPeriodo('pg.fecha')}
              AND EXISTS (SELECT 1 FROM venta v WHERE v.id = pg.venta_id AND v.estado_pago = 'PAGADA' AND ${ventaEn})
        GROUP BY mp.id, mp.nombre ORDER BY sum(pg.monto_total) DESC NULLS LAST`,
      p,
    );
    const porGrado = await this.ds.query(
      `SELECT coalesce(g.nombre, 'Sin grado') AS grado, count(DISTINCT va.id)::int AS alumnos,
              coalesce(sum(d.cantidad), 0)::int AS unidades,
              (coalesce(sum(d.subtotal), 0) - coalesce((SELECT sum(x.descuento) FROM venta_alumno x
                 JOIN venta vx ON vx.id = x.venta_id
                WHERE x.grado_id IS NOT DISTINCT FROM g.id AND vx.estado_pago = 'PAGADA'
                  AND ${enPeriodo('vx.fecha')} AND ($1::bigint IS NULL OR vx.colegio_id = $1)), 0))::numeric(12,2)::text AS ingresos
         FROM venta_alumno va JOIN venta v ON v.id = va.venta_id
         JOIN venta_detalle d ON d.venta_alumno_id = va.id
         LEFT JOIN grado g ON g.id = va.grado_id
        WHERE v.estado_pago = 'PAGADA' AND ${enPeriodo('v.fecha')} AND ${ventaEn}
        GROUP BY g.id, g.nombre, g.orden ORDER BY g.orden NULLS LAST`,
      p,
    );
    const topLibros = await this.ds.query(
      `SELECT l.titulo, sum(d.cantidad)::int AS unidades, sum(d.subtotal)::numeric(12,2)::text AS ingresos,
              coalesce(sum(d.cantidad) FILTER (WHERE ${DIA('v.fecha')} > ${HOY} - 7), 0)::int AS "ultimos7",
              coalesce(sum(d.cantidad) FILTER (WHERE ${DIA('v.fecha')} <= ${HOY} - 7
                                                 AND ${DIA('v.fecha')} > ${HOY} - 14), 0)::int AS "previos7"
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id JOIN libro l ON l.id = d.libro_id
        WHERE v.estado_pago = 'PAGADA' AND ${enPeriodo('v.fecha')} AND ${ventaEn}
        GROUP BY l.id, l.titulo ORDER BY sum(d.cantidad) DESC LIMIT 10`,
      p,
    );

    // ---------- Pendientes (foto de hoy) ----------
    const [pend] = await this.ds.query(
      `SELECT coalesce(sum(d.cantidad - d.cantidad_entregada), 0)::int AS unidades,
              count(DISTINCT v.id)::int AS ventas,
              coalesce(sum((d.cantidad - d.cantidad_entregada) * d.precio_unitario), 0)::numeric(12,2)::text AS monto
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
        WHERE v.estado_pago = 'PAGADA' AND d.estado NOT IN ('ENTREGADO', 'ANULADO') AND ${ventaEn}`,
      [col],
    );
    const antiguedad = await this.ds.query(
      `SELECT b.tramo, coalesce(sum(x.q), 0)::int AS unidades
         FROM (VALUES (1, '0–3 días'), (2, '4–7 días'), (3, '8–14 días'), (4, 'Más de 14 días')) AS b(orden, tramo)
         LEFT JOIN (
           SELECT CASE WHEN e <= 3 THEN 1 WHEN e <= 7 THEN 2 WHEN e <= 14 THEN 3 ELSE 4 END AS orden, q
             FROM (SELECT ${HOY} - ${DIA('v.fecha')} AS e, d.cantidad - d.cantidad_entregada AS q
                     FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
                    WHERE v.estado_pago = 'PAGADA' AND d.estado NOT IN ('ENTREGADO', 'ANULADO')
                      AND ($1::bigint IS NULL OR v.colegio_id = $1)) s
         ) x ON x.orden = b.orden
        GROUP BY b.orden, b.tramo ORDER BY b.orden`,
      [col],
    );
    const porEstado = await this.ds.query(
      `SELECT d.estado, sum(d.cantidad - d.cantidad_entregada)::int AS unidades
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
        WHERE v.estado_pago = 'PAGADA' AND d.estado NOT IN ('ENTREGADO', 'ANULADO') AND ${ventaEn}
        GROUP BY d.estado ORDER BY 2 DESC`,
      [col],
    );

    // ---------- Caja ----------
    const [caja] = await this.ds.query(
      `SELECT count(*)::int AS turnos,
              count(*) FILTER (WHERE t.diferencia_efectivo < 0)::int AS faltantes,
              coalesce(sum(t.diferencia_efectivo) FILTER (WHERE t.diferencia_efectivo < 0), 0)::text AS "montoFaltante",
              count(*) FILTER (WHERE t.diferencia_efectivo > 0)::int AS sobrantes,
              coalesce(sum(t.diferencia_efectivo) FILTER (WHERE t.diferencia_efectivo > 0), 0)::text AS "montoSobrante",
              count(*) FILTER (WHERE t.estado = 'CERRADO')::int AS "porValidar"
         FROM turno_caja t JOIN caja c ON c.id = t.caja_id
        WHERE ${enPeriodo('t.abierto_en')} AND ($1::bigint IS NULL OR c.colegio_id = $1)`,
      p,
    );

    const abasto = await this.abastecimiento(colegioId);

    return {
      periodo: { dias, colegioId: col },
      kpis,
      serie: serie.map((s) => ({ dia: s.dia, total: s.total, ventas: s.ventas })),
      pronostico: pron.puntos,
      proyeccion,
      porColegio,
      porMetodo,
      porGrado,
      topLibros,
      pendientes: { ...pend, antiguedad, porEstado },
      caja,
      abastecimiento: abasto,
      alertas: this.alertas(kpis, proyeccion, pend, antiguedad, caja, abasto),
    };
  }

  /**
   * Cobertura de cada libro en cada colegio y sugerencias de traslado o pedido. Se calcula con
   * TODOS los colegios (un traslado necesita ver el excedente de los demás); con `colegioId`
   * solo se devuelve lo que afecta a ese colegio.
   */
  async abastecimiento(colegioId?: number) {
    const filas: FilaStock[] = (
      await this.ds.query(
        `WITH lib AS (
           SELECT DISTINCT co.id AS colegio_id, l.id AS libro_id
             FROM colegio co CROSS JOIN libro l
            WHERE co.activo AND l.activo
              AND (EXISTS (SELECT 1 FROM inventario i WHERE i.colegio_id = co.id AND i.libro_id = l.id)
                   OR EXISTS (SELECT 1 FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
                               WHERE v.colegio_id = co.id AND d.libro_id = l.id))
         ),
         vend AS (
           SELECT v.colegio_id, d.libro_id,
                  sum(d.cantidad) FILTER (WHERE ${DIA('v.fecha')} > ${HOY} - 7) AS v7,
                  sum(d.cantidad) FILTER (WHERE ${DIA('v.fecha')} > ${HOY} - 28) AS v28
             FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
            WHERE v.estado_pago = 'PAGADA' AND ${DIA('v.fecha')} > ${HOY} - 28
            GROUP BY 1, 2
         ),
         pend AS (
           SELECT v.colegio_id, d.libro_id,
                  sum(d.cantidad - d.cantidad_entregada) FILTER (WHERE d.estado IN ('PENDIENTE_TRASLADO','PENDIENTE_PROVEEDOR')) AS pendientes,
                  sum(d.cantidad - d.cantidad_entregada) FILTER (WHERE d.estado IN ('EN_TRANSITO','EN_PEDIDO')) AS asignado
             FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
            WHERE v.estado_pago = 'PAGADA' GROUP BY 1, 2
         ),
         viene AS (
           SELECT destino_id AS colegio_id, td.libro_id, sum(td.cantidad) AS q
             FROM traslado t JOIN traslado_detalle td ON td.traslado_id = t.id
            WHERE t.estado = 'EN_TRANSITO' GROUP BY 1, 2
           UNION ALL
           SELECT p.colegio_destino_id, pd.libro_id, sum(pd.solicitado - pd.recibido)
             FROM pedido_proveedor p JOIN pedido_proveedor_detalle pd ON pd.pedido_id = p.id
            WHERE p.estado IN ('SOLICITADO','PARCIAL') GROUP BY 1, 2
         )
         SELECT lib.colegio_id AS "colegioId", co.nombre AS colegio, lib.libro_id AS "libroId", l.titulo,
                l.editorial,
                coalesce(i.existencia - i.reservado, 0)::int AS disponible,
                coalesce(pe.pendientes, 0)::int AS pendientes,
                greatest(0, coalesce((SELECT sum(q) FROM viene w WHERE w.colegio_id = lib.colegio_id
                                        AND w.libro_id = lib.libro_id), 0) - coalesce(pe.asignado, 0))::int AS "enCamino",
                coalesce(vd.v7, 0)::int AS vendidos7, coalesce(vd.v28, 0)::int AS vendidos28
           FROM lib JOIN colegio co ON co.id = lib.colegio_id JOIN libro l ON l.id = lib.libro_id
           LEFT JOIN inventario i ON i.colegio_id = lib.colegio_id AND i.libro_id = lib.libro_id
           LEFT JOIN vend vd ON vd.colegio_id = lib.colegio_id AND vd.libro_id = lib.libro_id
           LEFT JOIN pend pe ON pe.colegio_id = lib.colegio_id AND pe.libro_id = lib.libro_id
          ORDER BY co.nombre, l.titulo`,
      )
    ).map((f: FilaStock) => ({ ...f }));

    const cob = cobertura(filas, HORIZONTE);
    const proveedores: { id: number; nombre: string }[] = await this.ds.query(
      `SELECT id, nombre FROM proveedor WHERE activo ORDER BY nombre`,
    );
    // Proveedor sugerido: el que lleva la editorial en el nombre (p. ej. "Santillana Guatemala").
    const proveedorDe = (editorial: string | null) => {
      const e = (editorial ?? '').toLowerCase();
      return (e && proveedores.find((p) => p.nombre.toLowerCase().includes(e))) || null;
    };
    const sugerencias = sugerir(cob).map((s: Sugerencia) => ({
      ...s,
      proveedorId: s.tipo === 'PEDIDO' ? (proveedorDe(s.editorial)?.id ?? null) : null,
      proveedor: s.tipo === 'PEDIDO' ? (proveedorDe(s.editorial)?.nombre ?? null) : null,
    }));
    const afecta = (id: number | null | undefined) => !colegioId || id === colegioId;
    return {
      horizonteDias: HORIZONTE,
      filas: cob
        .filter((f) => afecta(f.colegioId))
        .sort(
          (a, b) =>
            ['CRITICO', 'ALTO', 'MEDIO', 'OK'].indexOf(a.riesgo) -
              ['CRITICO', 'ALTO', 'MEDIO', 'OK'].indexOf(b.riesgo) ||
            (a.diasCobertura ?? 1e9) - (b.diasCobertura ?? 1e9),
        ),
      sugerencias: sugerencias.filter((s) => afecta(s.destinoId) || afecta(s.origenId)),
      proveedores,
    };
  }

  private alertas(
    k: { recargos: string; anuladas: number; montoAnulado: string; ingresosVar: number | null },
    pr: {
      esperado: string;
      min: string;
      max: string;
      tendenciaSemanalPct: number | null;
      dias: number;
    },
    pend: { unidades: number; ventas: number; monto: string },
    antig: { tramo: string; unidades: number }[],
    caja: { faltantes: number; montoFaltante: string; porValidar: number },
    ab: {
      filas: { riesgo: string }[];
      sugerencias: { tipo: string; riesgo: string; cantidad: number }[];
    },
  ): Alerta[] {
    const a: Alerta[] = [];
    const criticos = ab.filas.filter((f) => f.riesgo === 'CRITICO').length;
    const sugT = ab.sugerencias.filter((s) => s.tipo === 'TRASLADO');
    const sugP = ab.sugerencias.filter((s) => s.tipo === 'PEDIDO');
    if (criticos)
      a.push({
        nivel: 'CRITICO',
        titulo: `${criticos} libro(s) en riesgo crítico de abastecimiento`,
        detalle: `Hay clientes esperando sin reposición en camino o existencias para menos de 3 días. El sistema sugiere ${sugT.length} traslado(s) y ${sugP.length} pedido(s).`,
        accion: 'abastecimiento',
      });
    const viejos = antig.find((x) => x.tramo === 'Más de 14 días')?.unidades ?? 0;
    if (viejos)
      a.push({
        nivel: 'ALTO',
        titulo: `${viejos} libro(s) pagados llevan más de 2 semanas sin entregarse`,
        detalle:
          'Riesgo de reclamos y devoluciones: priorice su traslado o pedido y avise a los padres.',
        accion: 'pendientes',
      });
    if (pend.unidades)
      a.push({
        nivel: 'MEDIO',
        titulo: `Q${Number(pend.monto).toLocaleString('es-GT', { minimumFractionDigits: 2 })} cobrados por libros aún no entregados`,
        detalle: `${pend.unidades} libro(s) en ${pend.ventas} venta(s). Es dinero comprometido: si no llegan, habrá que reembolsar.`,
        accion: 'pendientes',
      });
    if (caja.faltantes)
      a.push({
        nivel: 'MEDIO',
        titulo: `${caja.faltantes} cierre(s) de caja con faltante en el período`,
        detalle: `Total faltante: Q${Math.abs(Number(caja.montoFaltante)).toFixed(2)}. Revise si se repite con el mismo cajero o caja.`,
        accion: 'cuadres',
      });
    if (caja.porValidar)
      a.push({
        nivel: 'MEDIO',
        titulo: `${caja.porValidar} cierre(s) de caja por validar`,
        detalle: 'El contador debe validarlos para dar por cuadrado el efectivo.',
        accion: 'cuadres',
      });
    if (pr.tendenciaSemanalPct !== null && Number(pr.esperado) > 0)
      a.push({
        nivel: 'INFO',
        titulo: `Próximos ${pr.dias} días: se esperan ~Q${Number(pr.esperado).toLocaleString('es-GT', { maximumFractionDigits: 0 })} en ventas`,
        detalle: `Rango probable Q${Number(pr.min).toLocaleString('es-GT', { maximumFractionDigits: 0 })} – Q${Number(pr.max).toLocaleString('es-GT', { maximumFractionDigits: 0 })}. La tendencia ${pr.tendenciaSemanalPct >= 0 ? 'crece' : 'baja'} ${Math.abs(pr.tendenciaSemanalPct).toFixed(1)} % por semana: ${pr.tendenciaSemanalPct >= 5 ? 'prepare existencias y personal en caja.' : 'ritmo estable.'}`,
      });
    if (k.anuladas)
      a.push({
        nivel: 'INFO',
        titulo: `${k.anuladas} venta(s) anulada(s) en el período`,
        detalle: `Monto anulado: Q${Number(k.montoAnulado).toFixed(2)}.`,
      });
    return a;
  }
}
