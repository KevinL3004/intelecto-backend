import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Libro } from '../../database/entities';
import { coincide, patron } from '../../common/utils/busqueda';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { eliminarODesactivar } from '../../common/utils/soft-delete';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearLibroDto, EditarLibroDto } from './dto/libro.dto';

@Injectable()
export class LibrosService {
  constructor(
    @InjectRepository(Libro) private readonly repo: Repository<Libro>,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(f: PaginationDto) {
    const qb = this.repo.createQueryBuilder('l').orderBy('l.titulo');
    if (f.activo) qb.andWhere('l.activo = :a', { a: f.activo === 'true' });
    if (f.q)
      qb.andWhere(
        `(${coincide('l.titulo')} OR ${coincide('l.isbn')} OR ${coincide('l.editorial')})`,
        { q: patron(f.q) },
      );
    const [data, total] = await qb
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginate(data, total, f);
  }

  async obtener(id: number) {
    const l = await this.repo.findOneBy({ id });
    if (!l) throw new NotFoundException('Libro no encontrado');
    return l;
  }

  async crear(dto: CrearLibroDto, usuarioId: number, ip: string) {
    const l = await this.repo.save(this.repo.create({ ...dto, creadoPor: usuarioId }));
    await this.bitacora.registrar({
      usuarioId,
      accion: 'CREAR',
      entidad: 'libro',
      entidadId: l.id,
      despues: l,
      ip,
    });
    return l;
  }

  async editar(id: number, dto: EditarLibroDto, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    const despues = await this.repo.save({ ...antes, ...dto });
    await this.bitacora.registrar({
      usuarioId,
      accion: 'EDITAR',
      entidad: 'libro',
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
      entidad: 'libro',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado };
  }
}
