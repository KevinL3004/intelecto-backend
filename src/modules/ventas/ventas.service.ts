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
import { calcularRecargo, money } from '../../common/utils/money';
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
  AlumnoVentaDto,
  AnularVentaDto,
  CotizarVentaDto,
  CrearVentaDto,
  EntregarDto,
  EnviarComprobanteDto,
  FiltroVentasDto,
  LicenciaDto,
  LineaVentaDto,
} from './dto/venta.dto';
import { consultarVenta, datosEmpresa } from './consulta-venta';
import { CorreoService } from '../correo/correo.service';
import { AlumnosService } from '../alumnos/alumnos.service';

export interface LineaPlan {
  /** Índice del alumno (bloque) al que pertenece la línea; 0 si la venta no tiene alumnos. */
  grupo: number;
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
  /** Totales por alumno (mismo orden que `alumnos` en la petición). */
  grupos: { indice: number; subtotal: string; descuento: string; comboAplicado: boolean }[];
  subtotal: string;
  descuento: string;
  comboAplicado: boolean;
  /** subtotal − descuento: lo que deben cubrir los montos base de los pagos. */
  aPagar: string;
  pagos: ResultadoPagos | null;
  metodos: MetodoVigente[];
  /** Cuánto pagaría el cliente si paga TODO con cada método (para informarle el recargo). */
  totalSegunMetodo: {
    metodoPagoId: number;
    nombre: string;
    recargoPct: string;
    recargo: string;
    total: string;
  }[];
  errores: ErrorRegla[];
}

/** Bloque de libros de un alumno (o de la venta entera si no hay alumnos). */
interface Grupo {
  indice: number;
  alumno: AlumnoVentaDto | null;
  comboId?: number;
  lineas: LineaVentaDto[];
}

const gruposDe = (dto: CotizarVentaDto): Grupo[] => {
  if (dto.alumnos && dto.lineas)
    throw new BadRequestException('Envíe los libros por alumno o sin alumnos, no ambos');
  if (dto.alumnos)
    return dto.alumnos.map((a, indice) => ({
      indice,
      alumno: a,
      comboId: a.comboId,
      lineas: a.lineas,
    }));
  return [{ indice: 0, alumno: null, comboId: dto.comboId, lineas: dto.lineas ?? [] }];
};

@Injectable()
export class VentasService {
  constructor(
    private readonly ds: DataSource,
    private readonly turnos: TurnosService,
    private readonly bitacora: BitacoraService,
    private readonly correo: CorreoService,
    private readonly alumnos: AlumnosService,
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

      const [cliente] = await m.query(
        `SELECT id, correo, (nit = 'CF' AND f_norm(nombres || ' ' || apellidos) = 'consumidor final') AS generico
           FROM persona WHERE id = $1 AND activo`,
        [dto.clienteId],
      );
      if (!cliente) throw new BadRequestException('Cliente no encontrado');
      const grupos = gruposDe(dto);
      await this.validarAlumnos(m, grupos);

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
          (dto.alumnos ? null : dto.alumno) || null,
          (dto.alumnos?.length === 1 ? dto.alumnos[0].gradoId : dto.gradoId) ?? null,
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

      // Un registro por alumno (con su licencia); sus líneas quedan ligadas a él.
      const ventaAlumno = new Map<number, number>();
      for (const g of grupos) {
        if (!g.alumno) continue;
        const alumnoId = await this.resolverAlumno(m, g.alumno, cliente, colegioId, u.id);
        const r = c.grupos.find((x) => x.indice === g.indice)!;
        const [va] = await m.query(
          `INSERT INTO venta_alumno (venta_id, alumno_id, grado_id, combo_id, descuento, licencia, orden)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            v.id,
            alumnoId,
            g.alumno.gradoId ?? null,
            r.comboAplicado ? g.comboId : null,
            r.descuento,
            g.alumno.licencia ?? null,
            g.indice,
          ],
        );
        ventaAlumno.set(g.indice, va.id);
      }
      if (ventaAlumno.size)
        // Nombres de los alumnos en la cabecera, para buscar la venta por alumno.
        await m.query(
          `UPDATE venta SET alumno = (
             SELECT left(string_agg(trim(a.nombres || ' ' || a.apellidos), ', ' ORDER BY va.orden), 150)
               FROM venta_alumno va JOIN alumno a ON a.id = va.alumno_id WHERE va.venta_id = $1)
            WHERE id = $1`,
          [v.id],
        );

      for (const l of c.lineas) {
        const entregado = l.estado === 'ENTREGADO' ? l.cantidad : 0;
        const [d] = await m.query(
          `INSERT INTO venta_detalle (venta_id, libro_id, cantidad, cantidad_entregada, precio_unitario,
                                      subtotal, estado, colegio_origen_id, venta_alumno_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            v.id,
            l.libroId,
            l.cantidad,
            entregado,
            l.precio,
            l.subtotal,
            l.estado,
            l.colegioOrigenId,
            ventaAlumno.get(l.grupo) ?? null,
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
          despues: {
            codigo: v.codigo,
            total: pagos.total,
            lineas: c.lineas.length,
            alumnos: ventaAlumno.size,
          },
          ip,
        },
        m,
      );
      // El comprobante se envía solo si el cliente tiene correo (y el envío está habilitado).
      if (cliente.correo && !cliente.generico)
        await this.correo.encolarComprobante(m, v.id, cliente.correo, u.id);
      return v.id as number;
    });
    return this.obtener(ventaId, u);
  }

  /** Comprobante para imprimir: la venta agrupada por alumno y los datos del emisor. */
  async comprobante(id: number, u: UsuarioActual) {
    const venta = await this.obtener(id, u);
    return { venta, empresa: await datosEmpresa(this.ds) };
  }

  /** Reenvía el comprobante por correo (al del cliente o a otro). */
  async enviarComprobante(id: number, dto: EnviarComprobanteDto, u: UsuarioActual, ip: string) {
    const v = await this.obtener(id, u);
    if (!this.correo.habilitado)
      throw new BusinessError(
        'CORREO_NO_CONFIGURADO',
        'El envío de correos aún no está configurado en el sistema',
        503,
      );
    const destino = dto.correo ?? v.clienteCorreo;
    if (!destino)
      throw new BusinessError('SIN_CORREO', 'El cliente no tiene correo; escriba uno para enviar');
    await this.ds.transaction(async (m) => {
      if (dto.correo && dto.guardarEnCliente) {
        const [p] = await m.query(
          `SELECT correo, (nit = 'CF' AND f_norm(nombres || ' ' || apellidos) = 'consumidor final') AS generico
             FROM persona WHERE id = $1`,
          [v.clienteId],
        );
        // Un cajero solo completa el correo si faltaba; cambiar uno existente es de Admin/Contador
        // (evita desviar los comprobantes de un cliente a otra dirección).
        if (p?.correo && p.correo !== dto.correo && u.rol === Rol.CAJERO)
          throw new BusinessError(
            'CORREO_YA_REGISTRADO',
            'El cliente ya tiene un correo registrado; solo un administrador o contador puede cambiarlo',
            403,
          );
        if (p && !p.generico) {
          await m.query(`UPDATE persona SET correo = $2 WHERE id = $1`, [v.clienteId, dto.correo]);
          await this.bitacora.registrar(
            {
              usuarioId: u.id,
              accion: 'EDITAR',
              entidad: 'persona',
              entidadId: v.clienteId,
              antes: { correo: p.correo },
              despues: { correo: dto.correo },
              ip,
            },
            m,
          );
        }
      }
      await this.correo.encolarComprobante(m, id, destino, u.id);
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: 'ENVIAR_COMPROBANTE',
          entidad: 'venta',
          entidadId: id,
          despues: { destinatario: destino },
          ip,
        },
        m,
      );
    });
    return this.obtener(id, u);
  }

  /** Corrige la licencia digital de un alumno de la venta (queda en bitácora). */
  async editarLicencia(
    id: number,
    ventaAlumnoId: number,
    dto: LicenciaDto,
    u: UsuarioActual,
    ip: string,
  ) {
    await this.ds.transaction(async (m) => {
      const v = await this.bloquearVenta(m, id);
      if (u.rol === Rol.CAJERO && v.colegioId !== u.colegioId)
        throw new ForbiddenException('Solo puede modificar ventas de su colegio');
      if (v.estadoPago !== 'PAGADA')
        throw new BusinessError('VENTA_ANULADA', 'La venta está anulada');
      const [va] = await m.query(
        `SELECT id, licencia FROM venta_alumno WHERE id = $1 AND venta_id = $2 FOR UPDATE`,
        [ventaAlumnoId, id],
      );
      if (!va) throw new NotFoundException('El alumno no pertenece a esta venta');
      const nueva = dto.licencia ?? null;
      if (nueva) await this.licenciasLibres(m, [nueva], ventaAlumnoId);
      await m.query(`UPDATE venta_alumno SET licencia = $2 WHERE id = $1`, [va.id, nueva]);
      await this.bitacora.registrar(
        {
          usuarioId: u.id,
          accion: 'EDITAR_LICENCIA',
          entidad: 'venta',
          entidadId: id,
          antes: { ventaAlumnoId, licencia: va.licencia },
          despues: { ventaAlumnoId, licencia: nueva },
          ip,
        },
        m,
      );
    });
    return this.obtener(id, u);
  }

  // ---------- alumnos de la venta ----------

  /** Reglas antes de guardar: cada alumno identificado, sin repetir, licencias únicas. */
  private async validarAlumnos(m: EntityManager, grupos: Grupo[]) {
    const conAlumno = grupos.filter((g) => g.alumno);
    for (const g of conAlumno)
      if (!g.alumno!.alumnoId && !g.alumno!.nombres)
        throw new BadRequestException('Escriba el nombre de cada alumno');
    const ids = conAlumno.map((g) => g.alumno!.alumnoId).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Un mismo alumno aparece dos veces en la venta');
    const licencias = conAlumno.map((g) => g.alumno!.licencia).filter((x): x is string => !!x);
    if (new Set(licencias).size !== licencias.length)
      throw new BusinessError('LICENCIA_DUPLICADA', 'Hay una licencia repetida en la venta', 409);
    if (licencias.length) await this.licenciasLibres(m, licencias);
  }

  /** Una licencia solo se vende una vez (salvo que su venta se haya anulado). */
  private async licenciasLibres(m: EntityManager, licencias: string[], excepto?: number) {
    // Bloqueo por licencia: dos cajas no pueden registrar la misma a la vez.
    for (const l of [...licencias].sort())
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('licencia:' || upper($1)))`, [l]);
    const [usada] = await m.query(
      `SELECT va.licencia, v.codigo FROM venta_alumno va JOIN venta v ON v.id = va.venta_id
        WHERE upper(va.licencia) = ANY($1::text[]) AND v.estado_pago <> 'ANULADA'
          AND ($2::bigint IS NULL OR va.id <> $2) LIMIT 1`,
      [licencias.map((l) => l.toUpperCase()), excepto ?? null],
    );
    if (usada)
      throw new BusinessError(
        'LICENCIA_DUPLICADA',
        `La licencia ${usada.licencia} ya se registró en la venta ${usada.codigo}`,
        409,
      );
  }

  /**
   * Alumno de la venta: el registrado (alumnoId) o uno nuevo. Si el cliente ya tiene un alumno
   * con el mismo nombre, se reutiliza. Queda vinculado al cliente (salvo Consumidor Final genérico).
   */
  private async resolverAlumno(
    m: EntityManager,
    a: AlumnoVentaDto,
    cliente: { id: number; generico: boolean },
    colegioId: number,
    usuarioId: number,
  ): Promise<number> {
    let id = a.alumnoId;
    if (id) {
      const [x] = await m.query(`SELECT id FROM alumno WHERE id = $1 AND activo`, [id]);
      if (!x) throw new BadRequestException('Alumno no encontrado o inactivo');
    } else if (!cliente.generico) {
      const [x] = await m.query(
        `SELECT a.id FROM alumno a JOIN persona_alumno pa ON pa.alumno_id = a.id AND pa.persona_id = $1
          WHERE a.activo AND f_norm(a.nombres || ' ' || a.apellidos) = f_norm($2) LIMIT 1`,
        [cliente.id, `${a.nombres} ${a.apellidos ?? ''}`.trim()],
      );
      id = x?.id;
    }
    if (!id) {
      const [x] = await m.query(
        `INSERT INTO alumno (nombres, apellidos, colegio_id, grado_id, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [a.nombres, a.apellidos ?? '', colegioId, a.gradoId ?? null, usuarioId],
      );
      id = x.id as number;
    } else
      await m.query(
        `UPDATE alumno SET colegio_id = $2, grado_id = coalesce($3, grado_id) WHERE id = $1`,
        [id, colegioId, a.gradoId ?? null],
      );
    if (!cliente.generico) await this.alumnos.vincularEn(m, id, cliente.id);
    return id;
  }

  async obtener(id: number, u: UsuarioActual) {
    const v = await consultarVenta(this.ds, id);
    if (!v) throw new NotFoundException('Venta no encontrada');
    if (u.rol === Rol.CAJERO && v.usuarioId !== u.id && v.colegioId !== u.colegioId)
      throw new ForbiddenException('No puede ver esta venta');
    return v;
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
    if (f.clienteId) where.push(`v.cliente_id = ${p(f.clienteId)}`);
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
    const grupos = gruposDe(dto);
    for (const g of grupos) {
      const ids = g.lineas.map((l) => l.libroId);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException(
          'Hay libros repetidos para un mismo alumno; ajuste la cantidad en una sola línea',
        );
    }
    const ids = [...new Set(grupos.flatMap((g) => g.lineas.map((l) => l.libroId)))];

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

    // Disponible por libro; se va descontando a medida que se asigna a cada alumno
    // (dos hermanos que llevan el mismo libro comparten la misma existencia).
    const disponible = new Map<number, number>();
    if (bloquear)
      for (const [id, x] of await bloquearStock(m, colegioId, ids))
        disponible.set(id, x.disponible);
    else {
      const filas: { libroId: number; disponible: number }[] = await m.query(
        `SELECT libro_id AS "libroId", existencia - reservado AS disponible FROM inventario
          WHERE colegio_id = $1 AND libro_id = ANY($2::bigint[])`,
        [colegioId, ids],
      );
      for (const f of filas) disponible.set(f.libroId, f.disponible);
    }

    const entregarAhora = dto.entregarAhora ?? true;
    const lineas: LineaPlan[] = [];
    const origenes = new Map<number, { id: number; nombre: string } | null>();
    for (const g of grupos)
      for (const pedida of g.lineas) {
        const l = porLibro.get(pedida.libroId);
        const base = {
          grupo: g.indice,
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
        const { conStock, sinStock } = repartir(pedida.cantidad, disponible.get(l.id) ?? 0);
        disponible.set(l.id, (disponible.get(l.id) ?? 0) - conStock);
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
          if (!origenes.has(l.id)) {
            const [o] = await m.query(
              `SELECT d.colegio_id AS id, c.nombre FROM v_disponibilidad d JOIN colegio c ON c.id = d.colegio_id
                WHERE d.libro_id = $1 AND d.colegio_id <> $2 AND d.excedente > 0 AND c.activo
                ORDER BY d.excedente DESC LIMIT 1`,
              [l.id, colegioId],
            );
            origenes.set(l.id, o ?? null);
          }
          const origen = origenes.get(l.id);
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

    // Descuento de combo por alumno: cada uno con su combo completo.
    const resumen: Cotizacion['grupos'] = [];
    for (const g of grupos) {
      const subtotalG = lineas
        .filter((l) => l.grupo === g.indice)
        .reduce((a, l) => a.plus(l.subtotal), new Decimal(0));
      let descuentoG = new Decimal(0);
      if (g.comboId) {
        const [combo] = await m.query(
          `SELECT id, descuento FROM combo WHERE id = $1 AND colegio_id = $2 AND ciclo = $3 AND activo`,
          [g.comboId, colegioId, ciclo],
        );
        if (combo) {
          const libroscombo: { libroId: number; cantidad: number }[] = await m.query(
            `SELECT libro_id AS "libroId", cantidad FROM combo_libro WHERE combo_id = $1`,
            [combo.id],
          );
          if (comboCompleto(libroscombo, g.lineas))
            descuentoG = Decimal.min(money(combo.descuento), subtotalG);
        }
      }
      resumen.push({
        indice: g.indice,
        subtotal: subtotalG.toFixed(2),
        descuento: descuentoG.toFixed(2),
        comboAplicado: descuentoG.gt(0),
      });
    }
    const subtotal = lineas.reduce((a, l) => a.plus(l.subtotal), new Decimal(0));
    const descuento = resumen.reduce((a, g) => a.plus(g.descuento), new Decimal(0));
    const aPagar = subtotal.minus(descuento);

    const metodos: MetodoVigente[] = await m.query(
      `SELECT id, codigo, nombre, recargo_pct::text AS "recargoPct", requiere_referencia AS "requiereReferencia"
         FROM metodo_pago WHERE activo ORDER BY id`,
    );
    const pagos = dto.pagos
      ? calcularPagos(dto.pagos, new Map(metodos.map((x) => [x.id, x])), aPagar)
      : null;
    if (pagos) errores.push(...pagos.errores);
    const totalSegunMetodo = metodos.map((x) => {
      const recargo = calcularRecargo(aPagar, x.recargoPct);
      return {
        metodoPagoId: x.id,
        nombre: x.nombre,
        recargoPct: money(x.recargoPct).toFixed(2),
        recargo: recargo.toFixed(2),
        total: aPagar.plus(recargo).toFixed(2),
      };
    });

    return {
      colegioId,
      colegio: col.nombre,
      ciclo,
      lineas,
      grupos: resumen,
      subtotal: subtotal.toFixed(2),
      descuento: descuento.toFixed(2),
      comboAplicado: resumen.some((g) => g.comboAplicado),
      aPagar: aPagar.toFixed(2),
      pagos,
      metodos,
      totalSegunMetodo,
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
