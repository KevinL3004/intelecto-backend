import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessError } from '../../common/errors';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { coincide, patron } from '../../common/utils/busqueda';
import { BitacoraService } from '../bitacora/bitacora.service';
import {
  asignarFifo,
  bloquearStock,
  compactarLineas,
  kardex,
  marcarPendientes,
  moverStock,
} from '../inventario/stock';
import {
  CrearPedidoDto,
  CrearProveedorDto,
  EditarProveedorDto,
  FiltroPedidosDto,
  RecepcionDto,
} from './dto/proveedor.dto';
import { filas } from '../../common/utils/filas';

const ref = (id: number) => `P-${id}`;
const CAMPOS = `id, nombre, nit, contacto, telefono, correo, activo`;

@Injectable()
export class ProveedoresService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  // ---------- Proveedores ----------

  async listar(f: PaginationDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.activo) {
      params.push(f.activo === 'true');
      where.push(`activo = $${params.length}`);
    }
    if (f.q) {
      params.push(patron(f.q));
      const q = `$${params.length}`;
      where.push(
        `(${coincide('nombre', q)} OR ${coincide('nit', q)} OR ${coincide('contacto', q)})`,
      );
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM proveedor ${w}`,
      params,
    );
    params.push(f.limit, (f.page - 1) * f.limit);
    const data = await this.ds.query(
      `SELECT ${CAMPOS} FROM proveedor ${w} ORDER BY nombre LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return paginate(data, total, f);
  }

  private async proveedor(id: number, m: EntityManager = this.ds.manager) {
    const [p] = await m.query(`SELECT ${CAMPOS} FROM proveedor WHERE id = $1`, [id]);
    if (!p) throw new NotFoundException('Proveedor no encontrado');
    return p;
  }

  async crearProveedor(dto: CrearProveedorDto, usuarioId: number, ip: string) {
    const [p] = await this.ds.query(
      `INSERT INTO proveedor (nombre, nit, contacto, telefono, correo) VALUES ($1, $2, $3, $4, $5) RETURNING ${CAMPOS}`,
      [
        dto.nombre,
        dto.nit?.toUpperCase() ?? null,
        dto.contacto ?? null,
        dto.telefono ?? null,
        dto.correo ?? null,
      ],
    );
    await this.bitacora.registrar({
      usuarioId,
      accion: 'CREAR',
      entidad: 'proveedor',
      entidadId: p.id,
      despues: p,
      ip,
    });
    return p;
  }

  async editarProveedor(id: number, dto: EditarProveedorDto, usuarioId: number, ip: string) {
    const antes = await this.proveedor(id);
    const d = { ...antes, ...dto };
    const [p] = filas<Record<string, unknown>>(
      await this.ds.query(
        `UPDATE proveedor SET nombre = $2, nit = $3, contacto = $4, telefono = $5, correo = $6, activo = $7
        WHERE id = $1 RETURNING ${CAMPOS}`,
        [
          id,
          d.nombre,
          d.nit ? String(d.nit).toUpperCase() : null,
          d.contacto,
          d.telefono,
          d.correo,
          d.activo,
        ],
      ),
    );
    await this.bitacora.registrar({
      usuarioId,
      accion: 'EDITAR',
      entidad: 'proveedor',
      entidadId: id,
      antes,
      despues: p,
      ip,
    });
    return p;
  }

  async eliminarProveedor(id: number, usuarioId: number, ip: string) {
    const antes = await this.proveedor(id);
    const [{ usado }] = await this.ds.query(
      `SELECT EXISTS (SELECT 1 FROM pedido_proveedor WHERE proveedor_id = $1) AS usado`,
      [id],
    );
    // RN-18: con historial se desactiva; si nunca se usó, se borra.
    if (usado) await this.ds.query(`UPDATE proveedor SET activo = false WHERE id = $1`, [id]);
    else await this.ds.query(`DELETE FROM proveedor WHERE id = $1`, [id]);
    const resultado = usado ? 'DESACTIVADO' : 'ELIMINADO';
    await this.bitacora.registrar({
      usuarioId,
      accion: resultado,
      entidad: 'proveedor',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado };
  }

  // ---------- Pedidos ----------

  /** R-06: consolidado por libro y colegio de lo pendiente de proveedor (aún sin pedir). */
  porPedir(colegioId?: number) {
    return this.ds.query(
      `SELECT v.colegio_id AS "colegioId", c.nombre AS colegio, d.libro_id AS "libroId", l.titulo, l.isbn,
              l.editorial, sum(d.cantidad)::int AS pendientes, (now()::date - min(v.fecha)::date) AS "diasEspera"
         FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
         JOIN colegio c ON c.id = v.colegio_id JOIN libro l ON l.id = d.libro_id
        WHERE d.estado = 'PENDIENTE_PROVEEDOR' AND v.estado_pago = 'PAGADA'
          AND ($1::bigint IS NULL OR v.colegio_id = $1)
        GROUP BY 1, 2, 3, 4, 5, 6
        ORDER BY l.editorial NULLS LAST, l.titulo, c.nombre`,
      [colegioId ?? null],
    );
  }

  async pedidos(f: FiltroPedidosDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.estado) where.push(`pp.estado = ${p(f.estado)}`);
    if (f.colegioId) where.push(`pp.colegio_destino_id = ${p(f.colegioId)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM pedido_proveedor pp ${w}`,
      params,
    );
    const data = await this.ds.query(
      `SELECT pp.id, pp.estado, pr.nombre AS proveedor, c.nombre AS colegio, pp.observacion,
              pp.creado_en AS "creadoEn", pp.actualizado_en AS "actualizadoEn", u.username AS usuario,
              (SELECT sum(solicitado)::int FROM pedido_proveedor_detalle WHERE pedido_id = pp.id) AS solicitado,
              (SELECT sum(recibido)::int FROM pedido_proveedor_detalle WHERE pedido_id = pp.id) AS recibido
         FROM pedido_proveedor pp JOIN proveedor pr ON pr.id = pp.proveedor_id
         JOIN colegio c ON c.id = pp.colegio_destino_id LEFT JOIN usuario u ON u.id = pp.usuario_id
         ${w} ORDER BY pp.creado_en DESC
        LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`,
      params,
    );
    return paginate(data, total, f);
  }

  async pedido(id: number, m: EntityManager = this.ds.manager) {
    const [pp] = await m.query(
      `SELECT pp.id, pp.estado, pp.proveedor_id AS "proveedorId", pr.nombre AS proveedor,
              pp.colegio_destino_id AS "colegioDestinoId", c.nombre AS colegio, pp.observacion,
              pp.creado_en AS "creadoEn", pp.actualizado_en AS "actualizadoEn", u.username AS usuario
         FROM pedido_proveedor pp JOIN proveedor pr ON pr.id = pp.proveedor_id
         JOIN colegio c ON c.id = pp.colegio_destino_id LEFT JOIN usuario u ON u.id = pp.usuario_id
        WHERE pp.id = $1`,
      [id],
    );
    if (!pp) throw new NotFoundException('Pedido no encontrado');
    const items = await m.query(
      `SELECT d.libro_id AS "libroId", l.titulo, l.isbn, d.solicitado, d.recibido
         FROM pedido_proveedor_detalle d JOIN libro l ON l.id = d.libro_id
        WHERE d.pedido_id = $1 ORDER BY l.titulo`,
      [id],
    );
    return { ...pp, items };
  }

  /** CU-14: crea el pedido; las ventas pendientes de proveedor del colegio pasan a EN_PEDIDO (FIFO). */
  async crearPedido(dto: CrearPedidoDto, usuarioId: number, ip: string) {
    const id = await this.ds.transaction(async (m) => {
      const prov = await this.proveedor(dto.proveedorId, m);
      if (!prov.activo) throw new BadRequestException('El proveedor está inactivo');
      const [col] = await m.query(`SELECT id FROM colegio WHERE id = $1 AND activo`, [
        dto.colegioDestinoId,
      ]);
      if (!col) throw new BadRequestException('Colegio no encontrado o inactivo');
      const ids = dto.items.map((i) => i.libroId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Libros repetidos');
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM libro WHERE id = ANY($1::bigint[]) AND activo`,
        [ids],
      );
      if (n !== ids.length) throw new BadRequestException('Algún libro no existe o está inactivo');

      const [pp] = await m.query(
        `INSERT INTO pedido_proveedor (proveedor_id, colegio_destino_id, observacion, usuario_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [dto.proveedorId, dto.colegioDestinoId, dto.observacion ?? null, usuarioId],
      );
      for (const it of dto.items) {
        await m.query(
          `INSERT INTO pedido_proveedor_detalle (pedido_id, libro_id, solicitado) VALUES ($1, $2, $3)`,
          [pp.id, it.libroId, it.solicitado],
        );
        await marcarPendientes(
          m,
          dto.colegioDestinoId,
          it.libroId,
          'PENDIENTE_PROVEEDOR',
          'EN_PEDIDO',
          it.solicitado,
          {
            pedidoId: pp.id,
          },
        );
      }
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'CREAR',
          entidad: 'pedido_proveedor',
          entidadId: pp.id,
          despues: dto,
          ip,
        },
        m,
      );
      return pp.id as number;
    });
    return this.pedido(id);
  }

  /** Recepción total o parcial: suma al colegio destino y reserva FIFO (RN-14). */
  async recepcion(id: number, dto: RecepcionDto, usuarioId: number, ip: string) {
    const r = await this.ds.transaction(async (m) => {
      const pp = await this.bloquear(m, id);
      if (!['SOLICITADO', 'PARCIAL'].includes(pp.estado))
        throw new BusinessError('PEDIDO_CERRADO', 'El pedido ya fue recibido o cancelado');
      const det: { libroId: number; solicitado: number; recibido: number }[] = await m.query(
        `SELECT libro_id AS "libroId", solicitado, recibido FROM pedido_proveedor_detalle WHERE pedido_id = $1 FOR UPDATE`,
        [id],
      );
      const porLibro = new Map(det.map((d) => [d.libroId, d]));
      if (new Set(dto.items.map((i) => i.libroId)).size !== dto.items.length)
        throw new BadRequestException('Libros repetidos');
      await bloquearStock(
        m,
        pp.colegioId,
        dto.items.map((i) => i.libroId),
      );
      for (const it of dto.items) {
        const d = porLibro.get(it.libroId);
        if (!d) throw new BadRequestException('El libro no está en el pedido');
        if (d.recibido + it.cantidad > d.solicitado)
          throw new BusinessError(
            'RECIBIDO_EXCEDE',
            `Se pidieron ${d.solicitado} y ya se recibieron ${d.recibido}; no se pueden recibir ${it.cantidad} más`,
            422,
          );
        d.recibido += it.cantidad;
        await m.query(
          `UPDATE pedido_proveedor_detalle SET recibido = $3 WHERE pedido_id = $1 AND libro_id = $2`,
          [id, it.libroId, d.recibido],
        );
        await moverStock(m, pp.colegioId, it.libroId, { existencia: it.cantidad });
        await kardex(m, {
          colegioId: pp.colegioId,
          libroId: it.libroId,
          tipo: 'PROVEEDOR_ENTRADA',
          cantidad: it.cantidad,
          referencia: ref(id),
          motivo: dto.referencia ?? null,
          usuarioId,
        });
      }
      const completo = det.every((d) => d.recibido >= d.solicitado);
      const reservados = await asignarFifo(
        m,
        pp.colegioId,
        dto.items.map((i) => i.libroId),
        usuarioId,
      );
      if (completo) await this.liberarLineas(m, id);
      await m.query(`UPDATE pedido_proveedor SET estado = $2 WHERE id = $1`, [
        id,
        completo ? 'RECIBIDO' : 'PARCIAL',
      ]);
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'RECEPCION',
          entidad: 'pedido_proveedor',
          entidadId: id,
          despues: { ...dto, reservados },
          ip,
        },
        m,
      );
      return { reservadosParaPendientes: reservados };
    });
    return { ...r, pedido: await this.pedido(id) };
  }

  async cancelarPedido(id: number, usuarioId: number, ip: string) {
    await this.ds.transaction(async (m) => {
      const pp = await this.bloquear(m, id);
      if (!['SOLICITADO', 'PARCIAL'].includes(pp.estado))
        throw new BusinessError('PEDIDO_CERRADO', 'El pedido ya fue recibido o cancelado');
      await this.liberarLineas(m, id);
      await m.query(`UPDATE pedido_proveedor SET estado = 'CANCELADO' WHERE id = $1`, [id]);
      await this.bitacora.registrar(
        { usuarioId, accion: 'CANCELAR', entidad: 'pedido_proveedor', entidadId: id, ip },
        m,
      );
    });
    return this.pedido(id);
  }

  /** Las ventas que seguían esperando este pedido vuelven a "pendiente de proveedor". */
  private async liberarLineas(m: EntityManager, pedidoId: number) {
    const r = filas<{ ventaId: number }>(
      await m.query(
        `UPDATE venta_detalle SET estado = 'PENDIENTE_PROVEEDOR', pedido_proveedor_id = NULL
        WHERE pedido_proveedor_id = $1 AND estado = 'EN_PEDIDO' RETURNING venta_id AS "ventaId"`,
        [pedidoId],
      ),
    );
    await compactarLineas(
      m,
      r.map((x) => x.ventaId),
    );
  }

  private async bloquear(m: EntityManager, id: number) {
    const [pp] = await m.query(
      `SELECT id, estado, colegio_destino_id AS "colegioId" FROM pedido_proveedor WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!pp) throw new NotFoundException('Pedido no encontrado');
    return pp as { id: number; estado: string; colegioId: number };
  }
}
