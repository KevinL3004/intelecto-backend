import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Inventario, Libro, MovimientoInventario } from '../../database/entities';
import { coincide, patron } from '../../common/utils/busqueda';
import { paginate } from '../../common/dto/pagination.dto';
import { BusinessError } from '../../common/errors';
import { BitacoraService } from '../bitacora/bitacora.service';
import { AjusteDto, FiltroMovimientosDto, IngresoDto } from './dto/inventario.dto';

export interface FilaInventario {
  libroId: number;
  isbn: string | null;
  titulo: string;
  editorial: string | null;
  existencia: number;
  reservado: number;
  disponible: number;
  pendientes: number;
  excedente: number;
}

@Injectable()
export class InventarioService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  /** Existencias del colegio (todos los libros activos, aunque estén en 0). */
  async listar(colegioId: number, q?: string, soloConExistencia = false) {
    const params: unknown[] = [colegioId];
    let filtro = '';
    if (q) {
      params.push(patron(q));
      filtro += ` AND (${coincide('l.titulo', '$2')} OR ${coincide('l.isbn', '$2')})`;
    }
    if (soloConExistencia) filtro += ' AND coalesce(d.existencia,0) > 0';
    const filas: FilaInventario[] = await this.ds.query(
      `SELECT l.id AS "libroId", l.isbn, l.titulo, l.editorial,
              coalesce(d.existencia,0)::int         AS existencia,
              coalesce(d.reservado,0)::int          AS reservado,
              coalesce(d.disponible,0)::int         AS disponible,
              coalesce(d.pendientes_propios,0)::int AS pendientes,
              coalesce(d.excedente,0)::int          AS excedente
         FROM libro l
         LEFT JOIN v_disponibilidad d ON d.libro_id = l.id AND d.colegio_id = $1
        WHERE (l.activo OR d.libro_id IS NOT NULL) ${filtro}
        ORDER BY l.titulo`,
      params,
    );
    return filas;
  }

  async movimientos(f: FiltroMovimientosDto & { colegioId: number }) {
    const [data, total] = await this.ds.getRepository(MovimientoInventario).findAndCount({
      where: { colegioId: f.colegioId, ...(f.libroId ? { libroId: f.libroId } : {}) },
      relations: { libro: true },
      order: { fecha: 'DESC', id: 'DESC' },
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    });
    return paginate(data, total, f);
  }

  /** Entrada de mercadería: suma existencias y deja un movimiento INGRESO por libro. */
  async ingreso(dto: IngresoDto, usuarioId: number, ip: string) {
    const ids = dto.items.map((i) => i.libroId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Libros repetidos');

    return this.ds.transaction(async (m) => {
      const activos = await m.getRepository(Libro).countBy({ id: In(ids), activo: true });
      if (activos !== ids.length)
        throw new BadRequestException('Algún libro no existe o está inactivo');

      const resultado: { libroId: number; existencia: number }[] = [];
      for (const it of dto.items) {
        const [fila]: { existencia: number }[] = await m.query(
          `INSERT INTO inventario (colegio_id, libro_id, existencia) VALUES ($1, $2, $3)
           ON CONFLICT (colegio_id, libro_id) DO UPDATE
             SET existencia = inventario.existencia + EXCLUDED.existencia,
                 version    = inventario.version + 1
           RETURNING existencia`,
          [dto.colegioId, it.libroId, it.cantidad],
        );
        resultado.push({ libroId: it.libroId, existencia: fila.existencia });
      }
      await m.getRepository(MovimientoInventario).insert(
        dto.items.map((it) => ({
          colegioId: dto.colegioId,
          libroId: it.libroId,
          tipo: 'INGRESO' as const,
          cantidad: it.cantidad,
          referencia: dto.referencia ?? null,
          motivo: dto.motivo ?? null,
          usuarioId,
        })),
      );
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'INGRESO_INVENTARIO',
          entidad: 'inventario',
          entidadId: dto.colegioId,
          despues: dto,
          ip,
        },
        m,
      );
      return { items: resultado };
    });
  }

  /** Ajuste por conteo físico: fija la existencia y registra la diferencia (motivo obligatorio). */
  async ajuste(dto: AjusteDto, usuarioId: number, ip: string) {
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(Inventario);
      const actual = await repo
        .createQueryBuilder('i')
        .setLock('pessimistic_write')
        .where('i.colegio_id = :c AND i.libro_id = :l', { c: dto.colegioId, l: dto.libroId })
        .getOne();
      const antes = actual?.existencia ?? 0;
      const reservado = actual?.reservado ?? 0;
      const diferencia = dto.existencia - antes;
      if (diferencia === 0) return { existencia: antes, diferencia: 0 };
      if (dto.existencia < reservado)
        throw new BusinessError(
          'AJUSTE_BAJO_RESERVA',
          `No puede dejar ${dto.existencia}: hay ${reservado} unidades reservadas para ventas`,
          422,
        );

      if (actual)
        await repo.update(
          { colegioId: dto.colegioId, libroId: dto.libroId },
          { existencia: dto.existencia, version: actual.version + 1 },
        );
      else {
        const libro = await m.getRepository(Libro).findOneBy({ id: dto.libroId });
        if (!libro) throw new BadRequestException('Libro no encontrado');
        await repo.insert({
          colegioId: dto.colegioId,
          libroId: dto.libroId,
          existencia: dto.existencia,
          reservado: 0,
          version: 1,
        });
      }
      await m.getRepository(MovimientoInventario).insert({
        colegioId: dto.colegioId,
        libroId: dto.libroId,
        tipo: 'AJUSTE',
        cantidad: diferencia,
        motivo: dto.motivo,
        usuarioId,
      });
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'AJUSTE_INVENTARIO',
          entidad: 'inventario',
          entidadId: `${dto.colegioId}/${dto.libroId}`,
          antes: { existencia: antes },
          despues: { existencia: dto.existencia, motivo: dto.motivo },
          ip,
        },
        m,
      );
      return { existencia: dto.existencia, diferencia };
    });
  }
}
