import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Colegio } from '../../database/entities';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { eliminarODesactivar } from '../../common/utils/soft-delete';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearColegioDto, EditarColegioDto } from './dto/colegio.dto';

@Injectable()
export class ColegiosService {
  constructor(
    @InjectRepository(Colegio) private readonly repo: Repository<Colegio>,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(f: PaginationDto) {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.nombre');
    if (f.activo) qb.andWhere('c.activo = :a', { a: f.activo === 'true' });
    if (f.q)
      qb.andWhere('(lower(c.nombre) LIKE :q OR lower(c.codigo) LIKE :q)', {
        q: `%${f.q.toLowerCase()}%`,
      });
    const [data, total] = await qb
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginate(data, total, f);
  }

  async obtener(id: number) {
    const c = await this.repo.findOneBy({ id });
    if (!c) throw new NotFoundException('Colegio no encontrado');
    return c;
  }

  async crear(dto: CrearColegioDto, usuarioId: number, ip: string) {
    const c = await this.repo.save(this.repo.create({ ...dto, creadoPor: usuarioId }));
    await this.bitacora.registrar({
      usuarioId,
      accion: 'CREAR',
      entidad: 'colegio',
      entidadId: c.id,
      despues: c,
      ip,
    });
    return c;
  }

  async editar(id: number, dto: EditarColegioDto, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    const despues = await this.repo.save({ ...antes, ...dto });
    await this.bitacora.registrar({
      usuarioId,
      accion: 'EDITAR',
      entidad: 'colegio',
      entidadId: id,
      antes,
      despues,
      ip,
    });
    return despues;
  }

  async eliminar(id: number, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    const resultado = await eliminarODesactivar(this.repo, id);
    await this.bitacora.registrar({
      usuarioId,
      accion: resultado,
      entidad: 'colegio',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado };
  }
}
