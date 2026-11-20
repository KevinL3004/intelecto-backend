import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { c, Columna, Reporte } from './reporte.types';
import { FiltroReporteDto, TipoReporte } from './reportes.dto';

/** Límite de filas en pantalla; el Excel lleva hasta LIMITE_EXCEL. */
const LIMITE_PANTALLA = 2000;
const LIMITE_EXCEL = 50000;
const TZ = `'America/Guatemala'`;

/** Arma el WHERE con parámetros numerados ($1, $2…) sin concatenar valores. */
class Filtros {
  readonly params: unknown[] = [];
  readonly where: string[] = [];
  p(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  add(cond: string) {
    this.where.push(cond);
  }
  /** Rango de días completos en hora de Guatemala sobre una columna timestamptz. */
  rango(col: string, desde?: string, hasta?: string) {
    if (desde) this.add(`${col} >= (${this.p(desde)}::date)::timestamp AT TIME ZONE ${TZ}`);
    if (hasta) this.add(`${col} < ((${this.p(hasta)}::date + 1)::timestamp AT TIME ZONE ${TZ})`);
  }
  get sql() {
    return this.where.length ? `WHERE ${this.where.join(' AND ')}` : '';
  }
}

interface Definicion {
  titulo: string;
  columnas: Columna[];
  /** Columnas a totalizar al pie. */
  sumar: string[];
  /** Si se indica, solo esas filas entran a los totales (p. ej. ventas no anuladas). */
  cuentaParaTotal?: (f: Record<string, unknown>) => boolean;
  consulta: (
    f: FiltroReporteDto,
    u: UsuarioActual,
    limite: number,
  ) => { sql: string; params: unknown[] };
}

@Injectable()
export class ReportesService {
  constructor(private readonly ds: DataSource) {}

  async generar(
    tipo: TipoReporte,
    f: FiltroReporteDto,
    u: UsuarioActual,
    excel = false,
  ): Promise<Reporte> {
    const d = this.definiciones[tipo];
    const limite = excel ? LIMITE_EXCEL : LIMITE_PANTALLA;
    const { sql, params } = d.consulta(f, u, limite + 1);
    const filas: Record<string, unknown>[] = await this.ds.query(sql, params);
    const recortado = filas.length > limite;
    if (recortado) filas.length = limite;

    const totales: Record<string, string | number> = {};
    const base = d.cuentaParaTotal ? filas.filter(d.cuentaParaTotal) : filas;
    for (const clave of d.sumar) {
      const col = d.columnas.find((x) => x.clave === clave)!;
      if (col.tipo === 'dinero')
        totales[clave] = base
          .reduce((a, r) => a.plus(String(r[clave] ?? 0)), new Decimal(0))
          .toFixed(2);
      else totales[clave] = base.reduce((a, r) => a + Number(r[clave] ?? 0), 0);
    }
    return { titulo: d.titulo, columnas: d.columnas, filas, totales, recortado };
  }

  /** R-13: tablero del día (Admin/Contador). */
  async dashboard(colegioId?: number) {
    const col = colegioId ?? null;
    const hoy = `(now() AT TIME ZONE ${TZ})::date`;
    const desdeHoy = `(${hoy})::timestamp AT TIME ZONE ${TZ}`;
    const [ventas] = await this.ds.query(
      `SELECT count(*)::int AS ventas, coalesce(sum(total), 0)::numeric(12,2)::text AS total,
              coalesce(sum(recargo), 0)::numeric(12,2)::text AS recargo
         FROM venta WHERE estado_pago = 'PAGADA' AND fecha >= ${desdeHoy} AND ($1::bigint IS NULL OR colegio_id = $1)`,
      [col],
    );
    const porMetodo = await this.ds.query(
      `SELECT mp.nombre, count(p.id)::int AS pagos, coalesce(sum(p.monto_total), 0)::numeric(12,2)::text AS total
         FROM metodo_pago mp
         LEFT JOIN venta_pago p ON p.metodo_pago_id = mp.id AND NOT p.anulado AND p.fecha >= ${desdeHoy}
              AND EXISTS (SELECT 1 FROM venta v WHERE v.id = p.venta_id AND v.estado_pago = 'PAGADA'
                          AND ($1::bigint IS NULL OR v.colegio_id = $1))
        WHERE mp.activo GROUP BY mp.id, mp.nombre ORDER BY mp.id`,
      [col],
    );
    const pendientes = await this.ds.query(
      `SELECT d.estado, sum(d.cantidad - d.cantidad_entregada)::int AS unidades
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
        WHERE v.estado_pago = 'PAGADA' AND ($1::bigint IS NULL OR v.colegio_id = $1)
          AND d.estado IN ('RESERVADO','PENDIENTE_TRASLADO','EN_TRANSITO','PENDIENTE_PROVEEDOR','EN_PEDIDO')
        GROUP BY d.estado`,
      [col],
    );
    const cajasAbiertas = await this.ds.query(
      `SELECT t.id, t.estado, c.numero AS caja, co.nombre AS colegio, trim(pe.nombres || ' ' || pe.apellidos) AS cajero,
              t.abierto_en AS "abiertoEn"
         FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN colegio co ON co.id = c.colegio_id
         JOIN usuario u ON u.id = t.usuario_id JOIN persona pe ON pe.id = u.persona_id
        WHERE t.estado IN ('ABIERTO','EN_CIERRE') AND ($1::bigint IS NULL OR c.colegio_id = $1)
        ORDER BY co.nombre, c.numero`,
      [col],
    );
    const [porValidar] = await this.ds.query(
      `SELECT count(*)::int AS n FROM turno_caja t JOIN caja c ON c.id = t.caja_id
        WHERE t.estado IN ('CERRADO','OBSERVADO') AND ($1::bigint IS NULL OR c.colegio_id = $1)`,
      [col],
    );
    const ultimos7 = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              coalesce((SELECT sum(total) FROM venta v WHERE v.estado_pago = 'PAGADA'
                         AND ($1::bigint IS NULL OR v.colegio_id = $1)
                         AND (v.fecha AT TIME ZONE ${TZ})::date = d), 0)::numeric(12,2)::text AS total
         FROM generate_series(${hoy} - 6, ${hoy}, interval '1 day') AS g(d)
        ORDER BY d`,
      [col],
    );
    return {
      hoy: ventas,
      porMetodo,
      pendientes,
      cajasAbiertas,
      turnosPorValidar: porValidar.n,
      ultimos7,
    };
  }

  // ---------------------------------------------------------------------------------------------

  private readonly definiciones: Record<TipoReporte, Definicion> = {
    // R-01
    ventas: {
      titulo: 'Ventas por período',
      columnas: [
        c('codigo', 'Venta'),
        c('fecha', 'Fecha', 'fechaHora'),
        c('colegio', 'Colegio'),
        c('caja', 'Caja', 'entero'),
        c('usuario', 'Usuario'),
        c('cliente', 'Cliente'),
        c('nit', 'NIT'),
        c('subtotal', 'Subtotal', 'dinero'),
        c('descuento', 'Descuento', 'dinero'),
        c('recargo', 'Recargo', 'dinero'),
        c('total', 'Total', 'dinero'),
        c('estadoPago', 'Pago'),
        c('estadoEntrega', 'Entrega'),
      ],
      sumar: ['subtotal', 'descuento', 'recargo', 'total'],
      cuentaParaTotal: (r) => r.estadoPago === 'PAGADA',
      consulta: (f, u, limite) => {
        const q = new Filtros();
        q.rango('v.fecha', f.desde, f.hasta);
        if (u.rol === Rol.CAJERO) q.add(`v.usuario_id = ${q.p(u.id)}`);
        else if (f.usuarioId) q.add(`v.usuario_id = ${q.p(f.usuarioId)}`);
        if (f.colegioId) q.add(`v.colegio_id = ${q.p(f.colegioId)}`);
        if (f.cajaId) q.add(`t.caja_id = ${q.p(f.cajaId)}`);
        if (f.estado) q.add(`v.estado_pago = ${q.p(f.estado)}`);
        if (f.metodoPagoId)
          q.add(
            `EXISTS (SELECT 1 FROM venta_pago p WHERE p.venta_id = v.id AND p.metodo_pago_id = ${q.p(f.metodoPagoId)})`,
          );
        return {
          sql: `SELECT v.codigo, v.fecha, co.nombre AS colegio, ca.numero AS caja, us.username AS usuario,
                       trim(pc.nombres || ' ' || pc.apellidos) AS cliente, pc.nit,
                       v.subtotal::text, v.descuento::text, v.recargo::text, v.total::text,
                       v.estado_pago AS "estadoPago", v.estado_entrega AS "estadoEntrega"
                  FROM venta v JOIN colegio co ON co.id = v.colegio_id JOIN persona pc ON pc.id = v.cliente_id
                  LEFT JOIN usuario us ON us.id = v.usuario_id
                  LEFT JOIN turno_caja t ON t.id = v.turno_id LEFT JOIN caja ca ON ca.id = t.caja_id
                  ${q.sql} ORDER BY v.fecha DESC LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-02
    'metodos-pago': {
      titulo: 'Resumen por método de pago',
      columnas: [
        c('metodo', 'Método'),
        c('pagos', 'Pagos', 'entero'),
        c('base', 'Monto base', 'dinero'),
        c('recargo', 'Recargo', 'dinero'),
        c('total', 'Total cobrado', 'dinero'),
      ],
      sumar: ['pagos', 'base', 'recargo', 'total'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.add(`v.estado_pago = 'PAGADA' AND NOT p.anulado`);
        q.rango('p.fecha', f.desde, f.hasta);
        if (f.colegioId) q.add(`v.colegio_id = ${q.p(f.colegioId)}`);
        if (f.cajaId) q.add(`t.caja_id = ${q.p(f.cajaId)}`);
        if (f.usuarioId) q.add(`p.usuario_id = ${q.p(f.usuarioId)}`);
        if (f.metodoPagoId) q.add(`p.metodo_pago_id = ${q.p(f.metodoPagoId)}`);
        return {
          sql: `SELECT mp.nombre AS metodo, count(*)::int AS pagos, sum(p.monto_base)::text AS base,
                       sum(p.recargo)::text AS recargo, sum(p.monto_total)::text AS total
                  FROM venta_pago p JOIN venta v ON v.id = p.venta_id JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
                  LEFT JOIN turno_caja t ON t.id = p.turno_id
                  ${q.sql} GROUP BY mp.id, mp.nombre ORDER BY mp.id LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-03
    libros: {
      titulo: 'Libros vendidos',
      columnas: [
        c('titulo', 'Libro'),
        c('isbn', 'ISBN'),
        c('colegio', 'Colegio'),
        c('grado', 'Grado'),
        c('cantidad', 'Cantidad', 'entero'),
        c('monto', 'Monto', 'dinero'),
      ],
      sumar: ['cantidad', 'monto'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.add(`v.estado_pago = 'PAGADA' AND d.estado <> 'ANULADO'`);
        q.rango('v.fecha', f.desde, f.hasta);
        if (f.colegioId) q.add(`v.colegio_id = ${q.p(f.colegioId)}`);
        return {
          sql: `SELECT l.titulo, l.isbn, co.nombre AS colegio, coalesce(g.nombre, '—') AS grado,
                       sum(d.cantidad)::int AS cantidad, sum(d.subtotal)::text AS monto
                  FROM venta_detalle d JOIN venta v ON v.id = d.venta_id JOIN libro l ON l.id = d.libro_id
                  JOIN colegio co ON co.id = v.colegio_id LEFT JOIN grado g ON g.id = v.grado_id
                  ${q.sql}
                 GROUP BY l.titulo, l.isbn, co.nombre, g.nombre, g.orden
                 ORDER BY sum(d.cantidad) DESC, l.titulo LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-04
    pendientes: {
      titulo: 'Pendientes de entrega',
      columnas: [
        c('codigo', 'Venta'),
        c('fecha', 'Fecha', 'fecha'),
        c('dias', 'Días', 'entero'),
        c('colegio', 'Colegio'),
        c('cliente', 'Cliente'),
        c('telefono', 'Teléfono'),
        c('alumno', 'Alumno'),
        c('titulo', 'Libro'),
        c('cantidad', 'Por entregar', 'entero'),
        c('estado', 'Estado'),
      ],
      sumar: ['cantidad'],
      consulta: (f, u, limite) => {
        const q = new Filtros();
        q.add(`v.estado_pago = 'PAGADA'`);
        q.add(
          `d.estado IN ('RESERVADO','PENDIENTE_TRASLADO','EN_TRANSITO','PENDIENTE_PROVEEDOR','EN_PEDIDO')`,
        );
        if (u.rol === Rol.CAJERO) q.add(`v.colegio_id = ${q.p(u.colegioId)}`);
        else if (f.colegioId) q.add(`v.colegio_id = ${q.p(f.colegioId)}`);
        if (f.estado) q.add(`d.estado = ${q.p(f.estado)}`);
        q.rango('v.fecha', f.desde, f.hasta);
        return {
          sql: `SELECT v.codigo, v.fecha, ((now() AT TIME ZONE ${TZ})::date - (v.fecha AT TIME ZONE ${TZ})::date) AS dias, co.nombre AS colegio,
                       trim(pc.nombres || ' ' || pc.apellidos) AS cliente, pc.telefono, v.alumno, l.titulo,
                       (d.cantidad - d.cantidad_entregada) AS cantidad, d.estado
                  FROM venta_detalle d JOIN venta v ON v.id = d.venta_id JOIN libro l ON l.id = d.libro_id
                  JOIN colegio co ON co.id = v.colegio_id JOIN persona pc ON pc.id = v.cliente_id
                  ${q.sql} ORDER BY v.fecha, v.codigo LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-07
    cuadres: {
      titulo: 'Cuadres de caja',
      columnas: [
        c('turno', 'Turno', 'entero'),
        c('abiertoEn', 'Apertura', 'fechaHora'),
        c('cerradoEn', 'Cierre', 'fechaHora'),
        c('colegio', 'Colegio'),
        c('caja', 'Caja', 'entero'),
        c('cajero', 'Cajero'),
        c('fondo', 'Fondo', 'dinero'),
        c('esperado', 'Efectivo esperado', 'dinero'),
        c('contado', 'Efectivo contado', 'dinero'),
        c('diferencia', 'Diferencia', 'dinero'),
        c('tarjeta', 'Tarjeta', 'dinero'),
        c('transferencia', 'Transferencia', 'dinero'),
        c('estado', 'Estado'),
        c('forzado', 'Forzado'),
      ],
      sumar: ['esperado', 'contado', 'diferencia', 'tarjeta', 'transferencia'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.rango('t.abierto_en', f.desde, f.hasta);
        if (f.colegioId) q.add(`c.colegio_id = ${q.p(f.colegioId)}`);
        if (f.cajaId) q.add(`t.caja_id = ${q.p(f.cajaId)}`);
        if (f.usuarioId) q.add(`t.usuario_id = ${q.p(f.usuarioId)}`);
        if (f.estado) q.add(`t.estado = ${q.p(f.estado)}`);
        return {
          sql: `SELECT t.id AS turno, t.abierto_en AS "abiertoEn", t.cerrado_en AS "cerradoEn", co.nombre AS colegio,
                       c.numero AS caja, u.username AS cajero, t.fondo_inicial::text AS fondo,
                       t.efectivo_esperado::text AS esperado, t.efectivo_contado::text AS contado,
                       t.diferencia_efectivo::text AS diferencia, t.tarjeta_esperado::text AS tarjeta,
                       t.transferencia_esperado::text AS transferencia, t.estado,
                       CASE WHEN t.forzado THEN 'Sí' ELSE 'No' END AS forzado
                  FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN colegio co ON co.id = c.colegio_id
                  JOIN usuario u ON u.id = t.usuario_id
                  ${q.sql} ORDER BY t.abierto_en DESC LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-09
    existencias: {
      titulo: 'Existencias por colegio',
      columnas: [
        c('colegio', 'Colegio'),
        c('titulo', 'Libro'),
        c('isbn', 'ISBN'),
        c('existencia', 'Existencia', 'entero'),
        c('reservado', 'Reservado', 'entero'),
        c('disponible', 'Disponible', 'entero'),
        c('pendientes', 'Pendientes propios', 'entero'),
        c('excedente', 'Excedente', 'entero'),
      ],
      sumar: ['existencia', 'reservado', 'disponible', 'pendientes'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.add(`(d.existencia > 0 OR d.reservado > 0 OR d.pendientes_propios > 0)`);
        if (f.colegioId) q.add(`d.colegio_id = ${q.p(f.colegioId)}`);
        return {
          sql: `SELECT co.nombre AS colegio, l.titulo, l.isbn, d.existencia, d.reservado, d.disponible,
                       d.pendientes_propios::int AS pendientes, d.excedente::int AS excedente
                  FROM v_disponibilidad d JOIN colegio co ON co.id = d.colegio_id JOIN libro l ON l.id = d.libro_id
                  ${q.sql} ORDER BY co.nombre, l.titulo LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-10
    anuladas: {
      titulo: 'Ventas anuladas',
      columnas: [
        c('codigo', 'Venta'),
        c('fecha', 'Fecha venta', 'fechaHora'),
        c('anuladaEn', 'Anulada', 'fechaHora'),
        c('colegio', 'Colegio'),
        c('cliente', 'Cliente'),
        c('total', 'Total', 'dinero'),
        c('reembolsoEfectivo', 'Reembolso efectivo', 'dinero'),
        c('anuladaPor', 'Anulada por'),
        c('motivo', 'Motivo'),
      ],
      sumar: ['total', 'reembolsoEfectivo'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.add(`v.estado_pago = 'ANULADA'`);
        q.rango('v.anulada_en', f.desde, f.hasta);
        if (f.colegioId) q.add(`v.colegio_id = ${q.p(f.colegioId)}`);
        if (f.usuarioId) q.add(`v.anulada_por = ${q.p(f.usuarioId)}`);
        return {
          sql: `SELECT v.codigo, v.fecha, v.anulada_en AS "anuladaEn", co.nombre AS colegio,
                       trim(pc.nombres || ' ' || pc.apellidos) AS cliente, v.total::text,
                       coalesce((SELECT sum(monto) FROM movimiento_caja WHERE tipo = 'REEMBOLSO' AND referencia = v.codigo), 0)::numeric(12,2)::text AS "reembolsoEfectivo",
                       u.username AS "anuladaPor", v.motivo_anulacion AS motivo
                  FROM venta v JOIN colegio co ON co.id = v.colegio_id JOIN persona pc ON pc.id = v.cliente_id
                  LEFT JOIN usuario u ON u.id = v.anulada_por
                  ${q.sql} ORDER BY v.anulada_en DESC LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-11
    diferencias: {
      titulo: 'Diferencias de caja por usuario',
      columnas: [
        c('usuario', 'Usuario'),
        c('cajero', 'Nombre'),
        c('turnos', 'Turnos cerrados', 'entero'),
        c('conDiferencia', 'Con diferencia', 'entero'),
        c('faltantes', 'Faltantes', 'dinero'),
        c('sobrantes', 'Sobrantes', 'dinero'),
        c('neto', 'Neto', 'dinero'),
      ],
      sumar: ['turnos', 'conDiferencia', 'faltantes', 'sobrantes', 'neto'],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.add(`t.estado IN ('CERRADO','VALIDADO','OBSERVADO')`);
        q.rango('t.cerrado_en', f.desde, f.hasta);
        if (f.colegioId) q.add(`c.colegio_id = ${q.p(f.colegioId)}`);
        if (f.usuarioId) q.add(`t.usuario_id = ${q.p(f.usuarioId)}`);
        return {
          sql: `SELECT u.username AS usuario, trim(pe.nombres || ' ' || pe.apellidos) AS cajero,
                       count(*)::int AS turnos,
                       count(*) FILTER (WHERE t.diferencia_efectivo <> 0)::int AS "conDiferencia",
                       coalesce(-sum(t.diferencia_efectivo) FILTER (WHERE t.diferencia_efectivo < 0), 0)::numeric(12,2)::text AS faltantes,
                       coalesce(sum(t.diferencia_efectivo) FILTER (WHERE t.diferencia_efectivo > 0), 0)::numeric(12,2)::text AS sobrantes,
                       coalesce(sum(t.diferencia_efectivo), 0)::numeric(12,2)::text AS neto
                  FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN usuario u ON u.id = t.usuario_id
                  JOIN persona pe ON pe.id = u.persona_id
                  ${q.sql}
                 GROUP BY u.username, pe.nombres, pe.apellidos
                 ORDER BY sum(t.diferencia_efectivo) LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },

    // R-12
    bitacora: {
      titulo: 'Bitácora de auditoría',
      columnas: [
        c('fecha', 'Fecha', 'fechaHora'),
        c('usuario', 'Usuario'),
        c('accion', 'Acción'),
        c('entidad', 'Entidad'),
        c('entidadId', 'Id'),
        c('detalle', 'Detalle'),
        c('ip', 'IP'),
      ],
      sumar: [],
      consulta: (f, _u, limite) => {
        const q = new Filtros();
        q.rango('b.fecha', f.desde, f.hasta);
        if (f.usuarioId) q.add(`b.usuario_id = ${q.p(f.usuarioId)}`);
        if (f.entidad) q.add(`b.entidad = ${q.p(f.entidad)}`);
        return {
          sql: `SELECT b.fecha, u.username AS usuario, b.accion, b.entidad, b.entidad_id AS "entidadId",
                       left(coalesce(
                         CASE WHEN b.antes IS NOT NULL AND b.despues IS NOT NULL
                              THEN 'antes: ' || b.antes::text || ' → después: ' || b.despues::text
                              ELSE coalesce(b.despues, b.antes)::text END, ''), 500) AS detalle,
                       b.ip
                  FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
                  ${q.sql} ORDER BY b.fecha DESC, b.id DESC LIMIT ${q.p(limite)}`,
          params: q.params,
        };
      },
    },
  };
}
