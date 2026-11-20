import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { PrecioLibro } from '../../database/entities';
import { toMoneyString } from '../../common/utils/money';
import { cicloActual } from '../../common/utils/alcance';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CopiarPreciosDto, GuardarPreciosDto } from './dto/precio.dto';

export interface FilaPrecio {
  libroId: number;
  isbn: string | null;
  titulo: string;
  editorial: string | null;
  precio: string | null;
}

@Injectable()
export class PreciosService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  /** Todos los libros activos con su precio (o null) para el colegio y ciclo. */
  async listar(colegioId: number, ciclo?: number) {
    const c = ciclo ?? (await cicloActual(this.ds.manager));
    const filas: FilaPrecio[] = await this.ds.query(
      `SELECT l.id AS "libroId", l.isbn, l.titulo, l.editorial, p.precio::text AS precio
         FROM libro l
         LEFT JOIN precio_libro p ON p.libro_id = l.id AND p.colegio_id = $1 AND p.ciclo = $2
        WHERE l.activo OR p.id IS NOT NULL
        ORDER BY l.titulo`,
      [colegioId, c],
    );
    return { colegioId, ciclo: c, items: filas };
  }

  /** Guarda en bloque: crea, actualiza o quita (precio null). Una sola transacción. */
  async guardar(dto: GuardarPreciosDto, usuarioId: number, ip: string) {
    const ids = dto.items.map((i) => i.libroId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Libros repetidos');

    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(PrecioLibro);
      const actuales = await repo.findBy({
        colegioId: dto.colegioId,
        ciclo: dto.ciclo,
        libroId: In(ids),
      });
      const porLibro = new Map(actuales.map((p) => [p.libroId, p]));
      const antes: Record<number, string> = {};
      const despues: Record<number, string | null> = {};

      for (const item of dto.items) {
        const actual = porLibro.get(item.libroId);
        const nuevo = item.precio === null ? null : toMoneyString(item.precio);
        if ((actual?.precio ?? null) === nuevo) continue;
        if (actual) antes[item.libroId] = actual.precio;
        despues[item.libroId] = nuevo;
        if (nuevo === null) await repo.delete(actual!.id);
        else if (actual) await repo.update(actual.id, { precio: nuevo, actualizadoPor: usuarioId });
        else
          await repo.insert({
            colegioId: dto.colegioId,
            libroId: item.libroId,
            ciclo: dto.ciclo,
            precio: nuevo,
            actualizadoPor: usuarioId,
          });
      }

      const cambios = Object.keys(despues).length;
      if (cambios)
        await this.bitacora.registrar(
          {
            usuarioId,
            accion: 'PRECIOS',
            entidad: 'precio_libro',
            entidadId: `${dto.colegioId}/${dto.ciclo}`,
            antes,
            despues,
            ip,
          },
          m,
        );
      return { cambios };
    });
  }

  /** Copia precios de un colegio/ciclo a otro (p. ej. al abrir el ciclo siguiente). */
  async copiar(dto: CopiarPreciosDto, usuarioId: number, ip: string) {
    if (dto.colegioOrigenId === dto.colegioDestinoId && dto.cicloOrigen === dto.cicloDestino)
      throw new BadRequestException('El origen y el destino son iguales');

    return this.ds.transaction(async (m) => {
      const conflicto = dto.sobrescribir
        ? 'DO UPDATE SET precio = EXCLUDED.precio, actualizado_por = EXCLUDED.actualizado_por'
        : 'DO NOTHING';
      const r: unknown[] = await m.query(
        `INSERT INTO precio_libro (colegio_id, libro_id, ciclo, precio, actualizado_por)
         SELECT $3, p.libro_id, $4, p.precio, $5
           FROM precio_libro p JOIN libro l ON l.id = p.libro_id AND l.activo
          WHERE p.colegio_id = $1 AND p.ciclo = $2
         ON CONFLICT (colegio_id, libro_id, ciclo) ${conflicto}
         RETURNING libro_id`,
        [dto.colegioOrigenId, dto.cicloOrigen, dto.colegioDestinoId, dto.cicloDestino, usuarioId],
      );
      await this.bitacora.registrar(
        {
          usuarioId,
          accion: 'COPIAR_PRECIOS',
          entidad: 'precio_libro',
          entidadId: `${dto.colegioDestinoId}/${dto.cicloDestino}`,
          despues: { ...dto, copiados: r.length },
          ip,
        },
        m,
      );
      return { copiados: r.length };
    });
  }
}
