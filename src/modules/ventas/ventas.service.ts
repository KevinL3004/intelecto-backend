import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { BusinessError } from '../../common/errors';
import { paginate } from '../../common/dto/pagination.dto';
import { money } from '../../common/utils/money';
import { cicloActual } from '../../common/utils/alcance';
import { coincide, patron } from '../../common/utils/busqueda';
import { BitacoraService } from '../bitacora/bitacora.service';
import { TurnosService } from '../turnos/turnos.service';
import { asignarFifo, bloquearStock, kardex, moverStock } from '../inventario/stock';
import {
  calcularPagos,
  comboCompleto,
  ErrorRegla,
  EstadoLinea,
  estadoEntrega,
  MetodoVigente,
  repartir,
  ResultadoPagos,
} from './reglas-venta';
import {
  AnularVentaDto,
  CotizarVentaDto,
  CrearVentaDto,
  EntregarDto,
  FiltroVentasDto,
} from './dto/venta.dto';

export interface LineaPlan {
  libroId: number;
  titulo: string;
  isbn: string | null;
  cantidad: number;
  precio: string | null;
  subtotal: string;
  estado: EstadoLinea | null;
  /** Colegio sugerido para traslado (RN-12/13). */
  colegioOrigenId: number | null;
  colegioOrigen: string | null;
  error: string | null;
}

export interface Cotizacion {
  colegioId: number;
  colegio: string;
  ciclo: number;
  lineas: LineaPlan[];
  subtotal: string;
  descuento: string;
  comboAplicado: boolean;
  /** subtotal − descuento: lo que deben cubrir los montos base de los pagos. */
  aPagar: string;
  pagos: ResultadoPagos | null;
  metodos: MetodoVigente[];
  errores: ErrorRegla[];
}

@Injectable()
export class VentasService {
  constructor(
    private readonly ds: DataSource,
    private readonly turnos: TurnosService,
    private readonly bitacora: BitacoraService,
  ) {}

  /** POST /ventas/cotizar: calcula líneas, disponibilidad y pagos sin guardar nada. */
  async cotizar(dto: CotizarVentaDto, u: UsuarioActual) {
    const turno = await this.turnos.actual(u.id);
    const colegioId = this.colegioVenta(u, dto.colegioId, turno?.colegioId);
    return this.preparar(this.ds.manager, colegioId, dto, false);
  }

  /** CU-04/05: registra la venta presencial con sus pagos, todo en una transacción. */
  async crear(dto: CrearVentaDto, u: UsuarioActual, ip: string) {
    const ventaId = await this.ds.transaction(async (m) => {
      // RN-05: se requiere turno ABIERTO; todo pago queda ligado a él.
      const [turno] = await m.query(
        `SELECT t.id, c.colegio_id AS "colegioId" FROM turno_caja t JOIN caja c ON c.id = t.caja_id
          WHERE t.usuario_id = $1 AND t.estado = 'ABIERTO' FOR UPDATE OF t`,
        [u.id],
      );
      if (!turno)
        throw new BusinessError('TURNO_NO_ABIERTO', 'Abra un turno de caja para poder vender');
      const colegioId = this.colegioVenta(u, dto.colegioId, turno.colegioId);

      const [cliente] = await m.query(`SELECT id FROM persona WHERE id = $1 AND activo`, [
        dto.clienteId,
      ]);
      if (!cliente) throw new BadRequestException('Cliente no encontrado');

      const c = await this.preparar(m, colegioId, dto, true);
      if (c.errores.length) {
        const e = c.errores[0];
        throw new BusinessError(e.error, e.message, e.error === 'RECARGO_CAMBIO' ? 409 : 422);
      }
      const pagos = c.pagos!;

      const [v] = await m.query(
        `INSERT INTO venta (codigo, canal, colegio_id, cliente_id, alumno, grado_id, ciclo, turno_id, usuario_id,
                            subtotal, descuento, recargo, total, estado_pago, estado_entrega, observacion)
         VALUES ('V-' || to_char(now() AT TIME ZONE 'America/Guatemala', 'YYYY') || '-' ||
                 lpad(nextval('seq_codigo_venta')::text, 6, '0'),
                 'PRESENCIAL', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PAGADA', $12, $13)
         RETURNING id, codigo`,
        [
          colegioId,
          dto.clienteId,
          dto.alumno || null,
          dto.gradoId ?? null,
          c.ciclo,
          turno.id,
          u.id,
          c.subtotal,
          c.descuento,
          pagos.recargo,
          pagos.total,
          estadoEntrega(
            c.lineas.map((l) => ({
              estado: l.estado!,
              cantidad: l.cantidad,
              cantidadEntregada: l.estado === 'ENTREGADO' ? l.cantidad : 0,
            })),
          ),
          dto.observacion || null,
        ],
      );

      for (const l of c.lineas) {
        const entregado = l.estado === 'ENTREGADO' ? l.cantidad : 0;
        const [d] = await m.query(
          `INSERT INTO venta_detalle (venta_id, libro_id, cantidad, cantidad_entregada, precio_unitario,
                                      subtotal, estado, colegio_origen_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            v.id,
            l.libroId,
            l.cantidad,
            entregado,
            l.precio,
            l.subtotal,
            l.estado,
            l.colegioOrigenId,
          ],
        );
        if (l.estado === 'ENTREGADO') {
          await moverStock(m, colegioId, l.libroId, { existencia: -l.cantidad });
          await kardex(m, {
            colegioId,
            libroId: l.libroId,
            tipo: 'VENTA_ENTREGA',
            cantidad: -l.cantidad,
            referencia: v.codigo,
            usuarioId: u.id,
          });
          await m.query(
            `INSERT INTO entrega (venta_detalle_id, cantidad, usuario_id) VALUES ($1, $2, $3)`,
            [d.id, l.cantidad, u.id],
          );
        } else if (l.estado === 'RESERVADO') {
          await moverStock(m, colegioId, l.libroId, { reservado: l.cantidad });
          await kardex(m, {
            colegioId,
            libroId: l.libroId,
            tipo: 'RESERVA',
            cantidad: l.cantidad,
            referencia: v.codigo,
            motivo: 'El cliente recoge después',
            usuarioId: u.id,
          });
        }
      }

      for (const p of pagos.pagos)
        await m.query(
          `INSERT INTO venta_pago (venta_id, metodo_pago_id, turno_id, medio, monto_base, recargo_pct, recargo,
                                   monto_total, recibido, vuelto, referencia, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            v.id,
            p.metodoPagoId,
            turno.id,
            p.medio,
            p.montoBase,
            p.recargoPct,
            p.recargo,
            p.montoTotal,
            p.recibido,
            p.vuelto,
            p.referencia,
            u.id,
          ],
        );

      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: 'VENTA',
          entidad: 'venta',
          entidadId: v.id,
          despues: { codigo: v.codigo, total: pagos.total, lineas: c.lineas.length },
          ip,
        },
        m,
      );
      return v.id as number;
    });
    return this.obtener(ventaId, u);
  }

  async obtener(id: number, u: UsuarioActual) {
    const [v] = await this.ds.query(
      `SELECT v.id, v.codigo, v.canal, v.colegio_id AS "colegioId", co.nombre AS colegio, v.ciclo,
              v.cliente_id AS "clienteId", trim(pc.nombres || ' ' || pc.apellidos) AS cliente, pc.nit,
              v.alumno, v.grado_id AS "gradoId", g.nombre AS grado,
              v.subtotal, v.descuento, v.recargo, v.total, v.estado_pago AS "estadoPago",
              v.estado_entrega AS "estadoEntrega", v.observacion, v.fecha,
              v.usuario_id AS "usuarioId", us.username AS usuario, ca.numero AS "cajaNumero",
              v.motivo_anulacion AS "motivoAnulacion", v.anulada_en AS "anuladaEn",
              (SELECT username FROM usuario WHERE id = v.anulada_por) AS "anuladaPor"
         FROM venta v
         JOIN colegio co ON co.id = v.colegio_id
         JOIN persona pc ON pc.id = v.cliente_id
         LEFT JOIN grado g ON g.id = v.grado_id
         LEFT JOIN usuario us ON us.id = v.usuario_id
         LEFT JOIN turno_caja t ON t.id = v.turno_id LEFT JOIN caja ca ON ca.id = t.caja_id
        WHERE v.id = $1`,
      [id],
    );
    if (!v) throw new NotFoundException('Venta no encontrada');
    if (u.rol === Rol.CAJERO && v.usuarioId !== u.id && v.colegioId !== u.colegioId)
      throw new ForbiddenException('No puede ver esta venta');
    const lineas = await this.ds.query(
      `SELECT d.id, d.libro_id AS "libroId", l.titulo, l.isbn, d.cantidad, d.cantidad_entregada AS "cantidadEntregada",
              d.precio_unitario AS "precioUnitario", d.subtotal, d.estado,
              d.colegio_origen_id AS "colegioOrigenId", co.nombre AS "colegioOrigen"
         FROM venta_detalle d JOIN libro l ON l.id = d.libro_id
         LEFT JOIN colegio co ON co.id = d.colegio_origen_id
        WHERE d.venta_id = $1 ORDER BY l.titulo, d.id`,
      [id],
    );
    const pagos = await this.ds.query(
      `SELECT p.id, mp.codigo AS metodo, mp.nombre, p.medio, p.monto_base AS "montoBase",
              p.recargo_pct AS "recargoPct", p.recargo, p.monto_total AS "montoTotal",
              p.recibido, p.vuelto, p.referencia, p.anulado
         FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
        WHERE p.venta_id = $1 ORDER BY p.id`,
      [id],
    );
    return { ...v, lineas, pagos };
  }

  async listar(f: FiltroVentasDto, u: UsuarioActual) {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const pendientes = f.pendientesEntrega === 'true';
    if (pendientes) where.push(`v.estado_pago = 'PAGADA' AND v.estado_entrega <> 'COMPLETA'`);
    if (u.rol === Rol.CAJERO)
      // El cajero ve sus ventas; para entregar pendientes (CU-10) ve las de su colegio.
      where.push(pendientes ? `v.colegio_id = ${p(u.colegioId)}` : `v.usuario_id = ${p(u.id)}`);
    else if (f.colegioId) where.push(`v.colegio_id = ${p(f.colegioId)}`);
    if (f.turnoId) where.push(`v.turno_id = ${p(f.turnoId)}`);
    if (f.estadoPago) where.push(`v.estado_pago = ${p(f.estadoPago)}`);
    if (f.estadoEntrega) where.push(`v.estado_entrega = ${p(f.estadoEntrega)}`);
    if (f.desde)
      where.push(`v.fecha >= (${p(f.desde)}::date)::timestamp AT TIME ZONE 'America/Guatemala'`);
    if (f.hasta)
      where.push(
        `v.fecha < ((${p(f.hasta)}::date + 1)::timestamp AT TIME ZONE 'America/Guatemala')`,
      );
    if (f.q) {
      const q = p(patron(f.q));
      where.push(
        `(${coincide('v.codigo', q)} OR ${coincide("pc.nombres || ' ' || pc.apellidos", q)} OR ${coincide('pc.nit', q)} OR ${coincide('v.alumno', q)})`,
      );
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM venta v JOIN persona pc ON pc.id = v.cliente_id JOIN colegio co ON co.id = v.colegio_id
                  LEFT JOIN usuario us ON us.id = v.usuario_id ${w}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${base}`, params);
    const data = await this.ds.query(
      `SELECT v.id, v.codigo, v.fecha, co.nombre AS colegio, trim(pc.nombres || ' ' || pc.apellidos) AS cliente,
              pc.nit, v.alumno, v.total, v.recargo, v.estado_pago AS "estadoPago",
              v.estado_entrega AS "estadoEntrega", us.username AS usuario
         ${base} ORDER BY v.fecha DESC, v.id DESC
        LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`,
      params,
    );
    return paginate(data, total, f);
  }

  /** CU-10: entrega líneas RESERVADO (total o parcial). Descuenta existencia y reserva. */
  async entregar(id: number, dto: EntregarDto, u: UsuarioActual, ip: string) {
    await this.ds.transaction(async (m) => {
      const v = await this.bloquearVenta(m, id);
      if (u.rol === Rol.CAJERO && v.colegioId !== u.colegioId)
        throw new ForbiddenException('Solo puede entregar ventas de su colegio');
      if (v.estadoPago !== 'PAGADA')
        throw new BusinessError('VENTA_NO_PAGADA', 'Solo se entregan ventas pagadas');

      const lineas: {
        id: number;
        libroId: number;
        cantidad: number;
        entregada: number;
        estado: string;
      }[] = await m.query(
        `SELECT id, libro_id AS "libroId", cantidad, cantidad_entregada AS entregada, estado
           FROM venta_detalle WHERE venta_id = $1 FOR UPDATE`,
        [id],
      );
      const porId = new Map(lineas.map((l) => [l.id, l]));
      const pedidas = dto.lineas.map((e) => ({ e, l: porId.get(e.detalleId) }));
      if (new Set(dto.lineas.map((e) => e.detalleId)).size !== dto.lineas.length)
        throw new BadRequestException('Líneas repetidas');
      await bloquearStock(m, v.colegioId, pedidas.map((x) => x.l?.libroId ?? 0).filter(Boolean));
      for (const { e, l } of pedidas) {
        if (!l) throw new BadRequestException('La línea no pertenece a la venta');
        if (l.estado !== 'RESERVADO')
          throw new BusinessError(
            'LINEA_NO_ENTREGABLE',
            'Solo se entregan libros reservados (los pendientes de traslado o proveedor aún no llegan)',
          );
        if (e.cantidad > l.cantidad - l.entregada)
          throw new BusinessError(
            'CANTIDAD_EXCEDE',
            'La cantidad supera lo pendiente de entregar',
            422,
          );
        await moverStock(m, v.colegioId, l.libroId, {
          existencia: -e.cantidad,
          reservado: -e.cantidad,
        });
        await kardex(m, {
          colegioId: v.colegioId,
          libroId: l.libroId,
          tipo: 'VENTA_ENTREGA',
          cantidad: -e.cantidad,
          referencia: v.codigo,
          usuarioId: u.id,
        });
        await m.query(
          `INSERT INTO entrega (venta_detalle_id, cantidad, usuario_id) VALUES ($1, $2, $3)`,
          [l.id, e.cantidad, u.id],
        );
        l.entregada += e.cantidad;
        if (l.entregada === l.cantidad) l.estado = 'ENTREGADO';
        await m.query(
          `UPDATE venta_detalle SET cantidad_entregada = $2, estado = $3 WHERE id = $1`,
          [l.id, l.entregada, l.estado],
        );
      }
      await this.actualizarEstadoEntrega(m, id, lineas);
      await this.bitacora.registrar(
        { usuarioId: u.id, accion: 'ENTREGA', entidad: 'venta', entidadId: id, despues: dto, ip },
        m,
      );
    });
    return this.obtener(id, u);
  }

  /**
   * CU-15 / RN-16: anula con motivo (Admin/Contador). Libera reservas, devuelve al stock lo entregado
   * si regresa físicamente y registra el reembolso en efectivo en el turno ABIERTO de quien anula.
   */
  async anular(id: number, dto: AnularVentaDto, u: UsuarioActual, ip: string) {
    const r = await this.ds.transaction(async (m) => {
      const v = await this.bloquearVenta(m, id);
      if (v.estadoPago !== 'PAGADA')
        throw new BusinessError('VENTA_NO_ANULABLE', 'Solo se anulan ventas pagadas');

      const [ef] = await m.query(
        `SELECT coalesce(sum(p.monto_total) FILTER (WHERE mp.codigo = 'EFECTIVO'), 0)::text AS efectivo,
                coalesce(sum(p.monto_total) FILTER (WHERE mp.codigo <> 'EFECTIVO'), 0)::text AS otros
           FROM venta_pago p JOIN metodo_pago mp ON mp.id = p.metodo_pago_id
          WHERE p.venta_id = $1 AND NOT p.anulado`,
        [id],
      );
      const efectivo = money(ef.efectivo);
      let turnoReembolso: number | null = null;
      if (efectivo.gt(0)) {
        const [t] = await m.query(
          `SELECT id, fondo_inicial AS "fondoInicial" FROM turno_caja
            WHERE usuario_id = $1 AND estado = 'ABIERTO' FOR UPDATE`,
          [u.id],
        );
        if (!t)
          throw new BusinessError(
            'TURNO_NO_ABIERTO',
            `Para reembolsar Q${efectivo.toFixed(2)} en efectivo debe tener un turno de caja abierto`,
          );
        const { efectivoEsperado: hay } = await this.turnos.resumen(m, t.id, t.fondoInicial);
        if (efectivo.gt(hay))
          throw new BusinessError(
            'EFECTIVO_INSUFICIENTE',
            `Su caja tiene Q${hay} en efectivo; el reembolso es de Q${efectivo.toFixed(2)}`,
            422,
          );
        await m.query(
          `INSERT INTO movimiento_caja (turno_id, tipo, monto, motivo, referencia, usuario_id)
           VALUES ($1, 'REEMBOLSO', $2, $3, $4, $5)`,
          [
            t.id,
            efectivo.toFixed(2),
            `Anulación ${v.codigo}: ${dto.motivo}`.slice(0, 250),
            v.codigo,
            u.id,
          ],
        );
        turnoReembolso = t.id;
      }

      const lineas: {
        id: number;
        libroId: number;
        cantidad: number;
        entregada: number;
        estado: string;
      }[] = await m.query(
        `SELECT id, libro_id AS "libroId", cantidad, cantidad_entregada AS entregada, estado
             FROM venta_detalle WHERE venta_id = $1 FOR UPDATE`,
        [id],
      );
      await bloquearStock(
        m,
        v.colegioId,
        lineas.map((l) => l.libroId),
      );
      const liberados = new Set<number>();
      for (const l of lineas) {
        const reservado = l.estado === 'RESERVADO' ? l.cantidad - l.entregada : 0;
        if (reservado > 0) {
          await moverStock(m, v.colegioId, l.libroId, { reservado: -reservado });
          await kardex(m, {
            colegioId: v.colegioId,
            libroId: l.libroId,
            tipo: 'LIBERA',
            cantidad: -reservado,
            referencia: v.codigo,
            motivo: 'Anulación de venta',
            usuarioId: u.id,
          });
          liberados.add(l.libroId);
        }
        if (dto.devuelveLibros && l.entregada > 0) {
          await moverStock(m, v.colegioId, l.libroId, { existencia: l.entregada });
          await kardex(m, {
            colegioId: v.colegioId,
            libroId: l.libroId,
            tipo: 'ANULACION',
            cantidad: l.entregada,
            referencia: v.codigo,
            motivo: dto.motivo,
            usuarioId: u.id,
          });
          liberados.add(l.libroId);
        }
      }
      await m.query(`UPDATE venta_detalle SET estado = 'ANULADO' WHERE venta_id = $1`, [id]);
      await m.query(
        `UPDATE venta SET estado_pago = 'ANULADA', anulada_por = $2, motivo_anulacion = $3, anulada_en = now()
          WHERE id = $1`,
        [id, u.id, dto.motivo],
      );
      // El stock liberado o devuelto se asigna a otras ventas pendientes (RN-14).
      const reasignados = liberados.size
        ? await asignarFifo(m, v.colegioId, [...liberados], u.id)
        : 0;
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: 'ANULAR',
          entidad: 'venta',
          entidadId: id,
          antes: { estadoPago: 'PAGADA' },
          despues: { ...dto, reembolsoEfectivo: efectivo.toFixed(2), turnoReembolso },
          ip,
        },
        m,
      );
      return {
        reembolsoEfectivo: efectivo.toFixed(2),
        reembolsoOtrosMedios: money(ef.otros).toFixed(2),
        reasignadosAPendientes: reasignados,
      };
    });
    return { ...r, venta: await this.obtener(id, u) };
  }

  // ---------- auxiliares ----------

  /** DP-10: el cajero vende en el colegio de su caja; Admin/Contador pueden elegir otro. */
  private colegioVenta(u: UsuarioActual, solicitado?: number, deCaja?: number | null) {
    if (u.rol === Rol.CAJERO) {
      const propio = deCaja ?? u.colegioId;
      if (solicitado && solicitado !== propio)
        throw new ForbiddenException('Solo puede vender en el colegio de su caja');
      if (!propio) throw new BadRequestException('Usuario sin colegio asignado');
      return propio;
    }
    const c = solicitado ?? deCaja;
    if (!c) throw new BadRequestException('Indique el colegio de la venta');
    return c;
  }

  /**
   * Arma la venta: precios (RN-03), disponibilidad y estado por línea (RN-12), descuento de combo
   * y pagos (RN-01/02/06/07). Con `bloquear`, las filas de inventario quedan bloqueadas (FOR UPDATE).
   */
  private async preparar(
    m: EntityManager,
    colegioId: number,
    dto: CotizarVentaDto,
    bloquear: boolean,
  ): Promise<Cotizacion> {
    const errores: ErrorRegla[] = [];
    const ids = dto.lineas.map((l) => l.libroId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Hay libros repetidos; ajuste la cantidad en una sola línea');

    const [col] = await m.query(`SELECT id, nombre FROM colegio WHERE id = $1 AND activo`, [
      colegioId,
    ]);
    if (!col) throw new BadRequestException('Colegio no encontrado o inactivo');
    const ciclo = await cicloActual(m);

    const libros: {
      id: number;
      titulo: string;
      isbn: string | null;
      activo: boolean;
      precio: string | null;
    }[] = await m.query(
      `SELECT l.id, l.titulo, l.isbn, l.activo, p.precio::text AS precio
           FROM libro l LEFT JOIN precio_libro p ON p.libro_id = l.id AND p.colegio_id = $1 AND p.ciclo = $2
          WHERE l.id = ANY($3::bigint[])`,
      [colegioId, ciclo, ids],
    );
    const porLibro = new Map(libros.map((l) => [l.id, l]));

    let stock: Map<number, { disponible: number }>;
    if (bloquear) stock = await bloquearStock(m, colegioId, ids);
    else {
      const filas: { libroId: number; disponible: number }[] = await m.query(
        `SELECT libro_id AS "libroId", existencia - reservado AS disponible FROM inventario
          WHERE colegio_id = $1 AND libro_id = ANY($2::bigint[])`,
        [colegioId, ids],
      );
      stock = new Map(filas.map((f) => [f.libroId, f]));
    }

    const entregarAhora = dto.entregarAhora ?? true;
    const lineas: LineaPlan[] = [];
    for (const pedida of dto.lineas) {
      const l = porLibro.get(pedida.libroId);
      const base = {
        libroId: pedida.libroId,
        titulo: l?.titulo ?? '¿?',
        isbn: l?.isbn ?? null,
        precio: l?.precio ?? null,
        colegioOrigenId: null,
        colegioOrigen: null,
      };
      if (!l || !l.activo || l.precio === null) {
        const msg =
          !l || !l.activo
            ? 'Libro no encontrado o inactivo'
            : `"${l.titulo}" no tiene precio en ${col.nombre} para el ciclo ${ciclo}`;
        errores.push({ error: 'PRECIO_NO_DEFINIDO', message: msg });
        lineas.push({
          ...base,
          cantidad: pedida.cantidad,
          subtotal: '0.00',
          estado: null,
          error: msg,
        });
        continue;
      }
      const { conStock, sinStock } = repartir(pedida.cantidad, stock.get(l.id)?.disponible ?? 0);
      const sub = (q: number) => money(l.precio!).mul(q).toFixed(2);
      if (conStock > 0)
        lineas.push({
          ...base,
          cantidad: conStock,
          subtotal: sub(conStock),
          estado: entregarAhora ? 'ENTREGADO' : 'RESERVADO',
          error: null,
        });
      if (sinStock > 0) {
        // RN-12/13: si otro colegio tiene excedente → traslado (sugiere el de mayor excedente).
        const [origen] = await m.query(
          `SELECT d.colegio_id AS id, c.nombre FROM v_disponibilidad d JOIN colegio c ON c.id = d.colegio_id
            WHERE d.libro_id = $1 AND d.colegio_id <> $2 AND d.excedente > 0 AND c.activo
            ORDER BY d.excedente DESC LIMIT 1`,
          [l.id, colegioId],
        );
        lineas.push({
          ...base,
          cantidad: sinStock,
          subtotal: sub(sinStock),
          estado: origen ? 'PENDIENTE_TRASLADO' : 'PENDIENTE_PROVEEDOR',
          colegioOrigenId: origen?.id ?? null,
          colegioOrigen: origen?.nombre ?? null,
          error: null,
        });
      }
    }

    const subtotal = lineas.reduce((a, l) => a.plus(l.subtotal), new Decimal(0));
    let descuento = new Decimal(0);
    let comboAplicado = false;
    if (dto.comboId) {
      const [combo] = await m.query(
        `SELECT id, descuento FROM combo WHERE id = $1 AND colegio_id = $2 AND ciclo = $3 AND activo`,
        [dto.comboId, colegioId, ciclo],
      );
      if (combo) {
        const libroscombo: { libroId: number; cantidad: number }[] = await m.query(
          `SELECT libro_id AS "libroId", cantidad FROM combo_libro WHERE combo_id = $1`,
          [combo.id],
        );
        if (comboCompleto(libroscombo, dto.lineas)) {
          descuento = Decimal.min(money(combo.descuento), subtotal);
          comboAplicado = descuento.gt(0);
        }
      }
    }
    const aPagar = subtotal.minus(descuento);

    const metodos: MetodoVigente[] = await m.query(
      `SELECT id, codigo, nombre, recargo_pct::text AS "recargoPct", requiere_referencia AS "requiereReferencia"
         FROM metodo_pago WHERE activo ORDER BY id`,
    );
    const pagos = dto.pagos
      ? calcularPagos(dto.pagos, new Map(metodos.map((x) => [x.id, x])), aPagar)
      : null;
    if (pagos) errores.push(...pagos.errores);

    return {
      colegioId,
      colegio: col.nombre,
      ciclo,
      lineas,
      subtotal: subtotal.toFixed(2),
      descuento: descuento.toFixed(2),
      comboAplicado,
      aPagar: aPagar.toFixed(2),
      pagos,
      metodos,
      errores,
    };
  }

  private async bloquearVenta(m: EntityManager, id: number) {
    const [v] = await m.query(
      `SELECT id, codigo, colegio_id AS "colegioId", estado_pago AS "estadoPago"
         FROM venta WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!v) throw new NotFoundException('Venta no encontrada');
    return v as { id: number; codigo: string; colegioId: number; estadoPago: string };
  }

  private async actualizarEstadoEntrega(
    m: EntityManager,
    ventaId: number,
    lineas: { cantidad: number; entregada: number; estado: string }[],
  ) {
    const estado = estadoEntrega(
      lineas.map((l) => ({
        estado: l.estado as EstadoLinea,
        cantidad: l.cantidad,
        cantidadEntregada: l.entregada,
      })),
    );
    await m.query(`UPDATE venta SET estado_entrega = $2 WHERE id = $1`, [ventaId, estado]);
  }
}
