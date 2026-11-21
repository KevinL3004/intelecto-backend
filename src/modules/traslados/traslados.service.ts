import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessError } from '../../common/errors';
import { paginate } from '../../common/dto/pagination.dto';
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
  CrearTrasladoDto,
  FiltroTrasladosDto,
  ItemCantidadDto,
  RecibirTrasladoDto,
} from './dto/traslado.dto';
import { filas } from '../../common/utils/filas';

const ref = (id: number) => `T-${id}`;

@Injectable()
export class TrasladosService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  /**
   * R-05 / RN-13: por libro y colegio destino, unidades pendientes de traslado y los colegios
   * con excedente (disponible − sus propios pendientes), de mayor a menor.
   */
  sugerencias(destinoId?: number) {
    return this.ds.query(
      `WITH pend AS (
         SELECT v.colegio_id AS destino, d.libro_id, sum(d.cantidad)::int AS pendientes,
                min(v.fecha) AS desde
           FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
          WHERE d.estado = 'PENDIENTE_TRASLADO' AND v.estado_pago = 'PAGADA'
            AND ($1::bigint IS NULL OR v.colegio_id = $1)
          GROUP BY 1, 2)
       SELECT p.destino AS "destinoId", cd.nombre AS destino, p.libro_id AS "libroId", l.titulo, l.isbn,
              p.pendientes, (now()::date - p.desde::date) AS "diasEspera",
              coalesce((SELECT json_agg(json_build_object('colegioId', x.colegio_id, 'colegio', c.nombre,
                                                          'excedente', x.excedente) ORDER BY x.excedente DESC)
                          FROM v_disponibilidad x JOIN colegio c ON c.id = x.colegio_id
                         WHERE x.libro_id = p.libro_id AND x.colegio_id <> p.destino
                           AND x.excedente > 0 AND c.activo), '[]') AS origenes
         FROM pend p JOIN colegio cd ON cd.id = p.destino JOIN libro l ON l.id = p.libro_id
        ORDER BY cd.nombre, l.titulo`,
      [destinoId ?? null],
    );
  }

  async listar(f: FiltroTrasladosDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.estado) where.push(`t.estado = ${p(f.estado)}`);
    if (f.colegioId) {
      const c = p(f.colegioId);
      where.push(`(t.origen_id = ${c} OR t.destino_id = ${c})`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM traslado t ${w}`,
      params,
    );
    const data = await this.ds.query(
      `SELECT t.id, t.estado, co.nombre AS origen, cd.nombre AS destino, t.observacion,
              t.creado_en AS "creadoEn", t.despachado_en AS "despachadoEn", t.recibido_en AS "recibidoEn",
              (SELECT sum(cantidad)::int FROM traslado_detalle WHERE traslado_id = t.id) AS unidades,
              u.username AS usuario
         FROM traslado t JOIN colegio co ON co.id = t.origen_id JOIN colegio cd ON cd.id = t.destino_id
         LEFT JOIN usuario u ON u.id = t.usuario_id
         ${w} ORDER BY t.creado_en DESC
        LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`,
      params,
    );
    return paginate(data, total, f);
  }

  async obtener(id: number, m: EntityManager = this.ds.manager) {
    const [t] = await m.query(
      `SELECT t.id, t.estado, t.origen_id AS "origenId", co.nombre AS origen, t.destino_id AS "destinoId",
              cd.nombre AS destino, t.observacion, t.creado_en AS "creadoEn", t.despachado_en AS "despachadoEn",
              t.recibido_en AS "recibidoEn", u.username AS usuario,
              (SELECT username FROM usuario WHERE id = t.recibido_por) AS "recibidoPor"
         FROM traslado t JOIN colegio co ON co.id = t.origen_id JOIN colegio cd ON cd.id = t.destino_id
         LEFT JOIN usuario u ON u.id = t.usuario_id WHERE t.id = $1`,
      [id],
    );
    if (!t) throw new NotFoundException('Traslado no encontrado');
    const items = await m.query(
      `SELECT d.libro_id AS "libroId", l.titulo, l.isbn, d.cantidad, d.recibido
         FROM traslado_detalle d JOIN libro l ON l.id = d.libro_id
        WHERE d.traslado_id = $1 ORDER BY l.titulo`,
      [id],
    );
    return { ...t, items };
  }

  async crear(dto: CrearTrasladoDto, usuarioId: number, ip: string) {
    if (dto.origenId === dto.destinoId)
      throw new BadRequestException('El origen y el destino deben ser distintos');
    const id = await this.ds.transaction(async (m) => {
      const activos = await m.query(
        `SELECT id FROM colegio WHERE id = ANY($1::bigint[]) AND activo`,
        [[dto.origenId, dto.destinoId]],
      );
      if (activos.length !== 2) throw new BadRequestException('Colegio no encontrado o inactivo');
      await this.validarLibros(m, dto.items);
      const [t] = await m.query(
        `INSERT INTO traslado (origen_id, destino_id, observacion, usuario_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [dto.origenId, dto.destinoId, dto.observacion ?? null, usuarioId],
      );
      for (const it of dto.items)
        await m.query(
          `INSERT INTO traslado_detalle (traslado_id, libro_id, cantidad) VALUES ($1, $2, $3)`,
          [t.id, it.libroId, it.cantidad],
        );
      await this.bitacora.registrar(
        { usuarioId, accion: 'CREAR', entidad: 'traslado', entidadId: t.id, despues: dto, ip },
        m,
      );
      if (dto.despachar) await this.despacharEn(m, t.id, usuarioId, ip);
      return t.id as number;
    });
    return this.obtener(id);
  }

  async despachar(id: number, usuarioId: number, ip: string) {
    await this.ds.transaction((m) => this.despacharEn(m, id, usuarioId, ip));
    return this.obtener(id);
  }

  /**
   * RN-15: al despachar se descuenta del origen (EN_TRANSITO). Las ventas pendientes del destino
   * para esos libros pasan a EN_TRANSITO (FIFO), ligadas a este traslado.
   */
  private async despacharEn(m: EntityManager, id: number, usuarioId: number, ip: string) {
    const t = await this.bloquear(m, id);
    if (t.estado !== 'BORRADOR')
      throw new BusinessError('TRASLADO_NO_BORRADOR', 'Solo se despachan traslados en borrador');
    const items: ItemCantidadDto[] = await m.query(
      `SELECT libro_id AS "libroId", cantidad FROM traslado_detalle WHERE traslado_id = $1`,
      [id],
    );
    const stock = await bloquearStock(
      m,
      t.origenId,
      items.map((i) => i.libroId),
    );
    for (const it of items) {
      const disp = stock.get(it.libroId)?.disponible ?? 0;
      if (disp < it.cantidad) {
        const [l] = await m.query(`SELECT titulo FROM libro WHERE id = $1`, [it.libroId]);
        throw new BusinessError(
          'STOCK_INSUFICIENTE',
          `"${l.titulo}": el origen solo tiene ${disp} disponible(s) y se quieren enviar ${it.cantidad}`,
        );
      }
      await moverStock(m, t.origenId, it.libroId, { existencia: -it.cantidad });
      await kardex(m, {
        colegioId: t.origenId,
        libroId: it.libroId,
        tipo: 'TRASLADO_SALIDA',
        cantidad: -it.cantidad,
        referencia: ref(id),
        usuarioId,
      });
      await marcarPendientes(
        m,
        t.destinoId,
        it.libroId,
        'PENDIENTE_TRASLADO',
        'EN_TRANSITO',
        it.cantidad,
        {
          trasladoId: id,
        },
      );
    }
    await m.query(
      `UPDATE traslado SET estado = 'EN_TRANSITO', despachado_en = now() WHERE id = $1`,
      [id],
    );
    await this.bitacora.registrar(
      { usuarioId, accion: 'DESPACHAR', entidad: 'traslado', entidadId: id, ip },
      m,
    );
  }

  /**
   * RN-15 / CU-13: el destino confirma lo recibido (puede ser menos: queda como incidencia).
   * Suma al destino y reserva FIFO para las ventas pendientes (RN-14).
   */
  async recibir(id: number, dto: RecibirTrasladoDto, usuarioId: number, ip: string) {
    const r = await this.ds.transaction(async (m) => {
      const t = await this.bloquear(m, id);
      if (t.estado !== 'EN_TRANSITO')
        throw new BusinessError('TRASLADO_NO_EN_TRANSITO', 'El traslado no está en tránsito');
      const items: ItemCantidadDto[] = await m.query(
        `SELECT libro_id AS "libroId", cantidad FROM traslado_detalle WHERE traslado_id = $1`,
        [id],
      );
      const recibido = new Map(dto.items.map((i) => [i.libroId, i.recibido]));
      const faltantes: string[] = [];
      await bloquearStock(
        m,
        t.destinoId,
        items.map((i) => i.libroId),
      );
      for (const it of items) {
        const q = recibido.get(it.libroId);
        if (q === undefined) throw new BadRequestException('Indique lo recibido de cada libro');
        if (q > it.cantidad)
          throw new BusinessError('RECIBIDO_EXCEDE', 'No puede recibir más de lo enviado', 422);
        if (q < it.cantidad) faltantes.push(`${it.cantidad - q} de libro ${it.libroId}`);
        await m.query(
          `UPDATE traslado_detalle SET recibido = $3 WHERE traslado_id = $1 AND libro_id = $2`,
          [id, it.libroId, q],
        );
        if (q > 0) {
          await moverStock(m, t.destinoId, it.libroId, { existencia: q });
          await kardex(m, {
            colegioId: t.destinoId,
            libroId: it.libroId,
            tipo: 'TRASLADO_ENTRADA',
            cantidad: q,
            referencia: ref(id),
            usuarioId,
          });
        }
      }
      if (faltantes.length && !dto.observacion)
        throw new BusinessError(
          'OBSERVACION_REQUERIDA',
          'Se recibe menos de lo enviado: escriba una observación (incidencia)',
          422,
        );
      // Las líneas que esperaban este traslado vuelven a "pendiente" y se reservan FIFO con lo que llegó.
      const revertidas = filas<{ ventaId: number }>(
        await m.query(
          `UPDATE venta_detalle SET estado = 'PENDIENTE_TRASLADO', traslado_id = NULL
          WHERE traslado_id = $1 AND estado = 'EN_TRANSITO' RETURNING venta_id AS "ventaId"`,
          [id],
        ),
      );
      await compactarLineas(
        m,
        revertidas.map((x) => x.ventaId),
      );
      const reservados = await asignarFifo(
        m,
        t.destinoId,
        items.map((i) => i.libroId),
        usuarioId,
      );
      const obs = [t.observacion, dto.observacion && `Recepción: ${dto.observacion}`]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 250);
      await m.query(
        `UPDATE traslado SET estado = 'RECIBIDO', recibido_en = now(), recibido_por = $2, observacion = $3 WHERE id = $1`,
        [id, usuarioId, obs || null],
      );
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'RECIBIR',
          entidad: 'traslado',
          entidadId: id,
          despues: { ...dto, faltantes, reservados },
          ip,
        },
        m,
      );
      return { reservadosParaPendientes: reservados, incidencia: faltantes.length > 0 };
    });
    return { ...r, traslado: await this.obtener(id) };
  }

  async cancelar(id: number, usuarioId: number, ip: string) {
    await this.ds.transaction(async (m) => {
      const t = await this.bloquear(m, id);
      if (t.estado !== 'BORRADOR')
        throw new BusinessError(
          'TRASLADO_NO_CANCELABLE',
          'Solo se cancelan traslados en borrador; uno en tránsito se recibe (aunque sea en 0)',
        );
      await m.query(`UPDATE traslado SET estado = 'CANCELADO' WHERE id = $1`, [id]);
      await this.bitacora.registrar(
        { usuarioId, accion: 'CANCELAR', entidad: 'traslado', entidadId: id, ip },
        m,
      );
    });
    return this.obtener(id);
  }

  private async bloquear(m: EntityManager, id: number) {
    const [t] = await m.query(
      `SELECT id, estado, origen_id AS "origenId", destino_id AS "destinoId", observacion
         FROM traslado WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!t) throw new NotFoundException('Traslado no encontrado');
    return t as {
      id: number;
      estado: string;
      origenId: number;
      destinoId: number;
      observacion: string | null;
    };
  }

  private async validarLibros(m: EntityManager, items: ItemCantidadDto[]) {
    const ids = items.map((i) => i.libroId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Libros repetidos');
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM libro WHERE id = ANY($1::bigint[]) AND activo`,
      [ids],
    );
    if (n !== ids.length) throw new BadRequestException('Algún libro no existe o está inactivo');
  }
}
