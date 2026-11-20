import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Persona, Usuario } from '../../database/entities';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { BusinessError } from '../../common/errors';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearUsuarioDto, EditarUsuarioDto } from './dto/usuario.dto';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly repo: Repository<Usuario>,
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
  ) {}

  async listar(f: PaginationDto & { rol?: string }) {
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.persona', 'p')
      .leftJoinAndSelect('u.colegio', 'c')
      .orderBy('u.username');
    if (f.activo) qb.andWhere('u.activo = :a', { a: f.activo === 'true' });
    if (f.rol) qb.andWhere('u.rol = :rol', { rol: f.rol });
    if (f.q) {
      qb.andWhere("(lower(u.username) LIKE :q OR lower(p.nombres || ' ' || p.apellidos) LIKE :q)", {
        q: `%${f.q.toLowerCase()}%`,
      });
    }
    const [data, total] = await qb
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginate(data, total, f);
  }

  async obtener(id: number) {
    const u = await this.repo.findOne({
      where: { id },
      relations: { persona: true, colegio: true },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return u;
  }

  async crear(dto: CrearUsuarioDto, actorId: number, ip: string) {
    if (!dto.personaId && !dto.persona) throw new BadRequestException('Envíe personaId o persona');
    return this.ds.transaction(async (m) => {
      const existe = await m.getRepository(Usuario).exists({ where: { username: dto.username } });
      if (existe) throw new BusinessError('USUARIO_DUPLICADO', 'El nombre de usuario ya existe');

      let personaId = dto.personaId;
      if (!personaId && dto.persona) {
        const p = await m.getRepository(Persona).save(
          m.getRepository(Persona).create({
            ...dto.persona,
            apellidos: dto.persona.apellidos ?? '',
            nit: dto.persona.nit || 'CF',
            creadoPor: actorId,
          }),
        );
        personaId = p.id;
      }
      const u = await m.getRepository(Usuario).save(
        m.getRepository(Usuario).create({
          personaId,
          username: dto.username,
          passwordHash: await bcrypt.hash(dto.password, 10),
          rol: dto.rol,
          colegioId: dto.colegioId ?? null,
          debeCambiarPassword: true,
          creadoPor: actorId,
        }),
      );
      await this.bitacora.registrar(
        {
          usuarioId: actorId,
          accion: 'CREAR',
          entidad: 'usuario',
          entidadId: u.id,
          despues: { ...u, passwordHash: undefined },
          ip,
        },
        m,
      );
      return { id: u.id, username: u.username, rol: u.rol, personaId };
    });
  }

  async editar(id: number, dto: EditarUsuarioDto, actorId: number, ip: string) {
    const antes = await this.obtener(id);
    if (id === actorId && (dto.activo === false || (dto.rol && dto.rol !== antes.rol))) {
      throw new BusinessError(
        'AUTO_MODIFICACION',
        'No puede desactivarse ni cambiar su propio rol',
      );
    }
    await this.repo.update(id, dto);
    const despues = await this.obtener(id);
    await this.bitacora.registrar({
      usuarioId: actorId,
      accion: 'EDITAR',
      entidad: 'usuario',
      entidadId: id,
      antes,
      despues,
      ip,
    });
    return despues;
  }

  async resetPassword(id: number, password: string, actorId: number, ip: string) {
    await this.obtener(id);
    await this.repo.update(id, {
      passwordHash: await bcrypt.hash(password, 10),
      debeCambiarPassword: true,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    await this.bitacora.registrar({
      usuarioId: actorId,
      accion: 'RESET_PASSWORD',
      entidad: 'usuario',
      entidadId: id,
      ip,
    });
    return { ok: true };
  }

  /** Los usuarios siempre tienen historial (bitácora): se desactivan. */
  async desactivar(id: number, actorId: number, ip: string) {
    return this.editar(id, { activo: false }, actorId, ip);
  }
}
