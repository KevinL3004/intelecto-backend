import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, Repository } from 'typeorm';
import { Bitacora } from '../../database/entities';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';

export interface RegistroBitacora {
  usuarioId: number | null;
  accion: string;
  entidad: string;
  entidadId?: string | number | null;
  antes?: unknown;
  despues?: unknown;
  ip?: string | null;
}

/** Quita campos sensibles antes de guardar en bitácora. */
const limpiar = (obj: unknown) => {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const copia = { ...(obj as Record<string, unknown>) };
  delete copia.passwordHash;
  delete copia.password;
  return copia;
};

@Injectable()
export class BitacoraService {
  constructor(@InjectRepository(Bitacora) private readonly repo: Repository<Bitacora>) {}

  /** Usar el manager de la transacción cuando exista, para que se guarde junto con el cambio. */
  async registrar(r: RegistroBitacora, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(Bitacora) : this.repo;
    await repo.insert({
      usuarioId: r.usuarioId,
      accion: r.accion,
      entidad: r.entidad,
      entidadId: r.entidadId != null ? String(r.entidadId) : null,
      antes: limpiar(r.antes) as never,
      despues: limpiar(r.despues) as never,
      ip: r.ip ?? null,
    });
  }

  async listar(
    f: PaginationDto & { entidad?: string; usuarioId?: number; desde?: string; hasta?: string },
  ) {
    const where: Record<string, unknown> = {};
    if (f.entidad) where.entidad = f.entidad;
    if (f.usuarioId) where.usuarioId = f.usuarioId;
    if (f.desde && f.hasta) where.fecha = Between(new Date(f.desde), new Date(f.hasta));
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { fecha: 'DESC' },
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    });
    return paginate(data, total, f);
  }
}
