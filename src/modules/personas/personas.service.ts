import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Persona } from '../../database/entities';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { eliminarODesactivar } from '../../common/utils/soft-delete';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearPersonaDto, EditarPersonaDto } from './dto/persona.dto';

@Injectable()
export class PersonasService {
  constructor(
    @InjectRepository(Persona) private readonly repo: Repository<Persona>,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(f: PaginationDto) {
    const qb = this.repo.createQueryBuilder('p').orderBy('p.nombres').addOrderBy('p.apellidos');
    if (f.activo) qb.andWhere('p.activo = :a', { a: f.activo === 'true' });
    if (f.q) {
      const q = `%${f.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where("lower(p.nombres || ' ' || p.apellidos) LIKE :q", { q })
            .orWhere('lower(p.nit) LIKE :q', { q })
            .orWhere('p.dpi LIKE :q', { q }),
        ),
      );
    }
    const [data, total] = await qb
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginate(data, total, f);
  }

  async obtener(id: number) {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException('Persona no encontrada');
    return p;
  }

  async crear(dto: CrearPersonaDto, usuarioId: number, ip: string) {
    const p = await this.repo.save(
      this.repo.create({
        ...dto,
        apellidos: dto.apellidos ?? '',
        nit: dto.nit || 'CF',
        creadoPor: usuarioId,
      }),
    );
    await this.bitacora.registrar({
      usuarioId,
      accion: 'CREAR',
      entidad: 'persona',
      entidadId: p.id,
      despues: p,
      ip,
    });
    return p;
  }

  async editar(id: number, dto: EditarPersonaDto, usuarioId: number, ip: string) {
    const antes = await this.obtener(id);
    const despues = await this.repo.save({ ...antes, ...dto });
    await this.bitacora.registrar({
      usuarioId,
      accion: 'EDITAR',
      entidad: 'persona',
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
      entidad: 'persona',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado };
  }
}
