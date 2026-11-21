import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Persona, Usuario } from '../../database/entities';
import { coincide, patron } from '../../common/utils/busqueda';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { BusinessError } from '../../common/errors';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearUsuarioDto, EditarUsuarioDto } from './dto/usuario.dto';
import { Rol } from '../../common/roles';
import { estadoUsuarioCache } from '../../common/guards/estado-usuario';
import { BCRYPT_COSTO, mensajePassword, problemasPassword } from '../../common/utils/password';
import { SesionesService } from '../auth/sesiones.service';

/** El cajero opera en un solo colegio: es obligatorio asignarlo. */
function validarColegioCajero(rol: Rol, colegioId: number | null | undefined) {
  if (rol === Rol.CAJERO && !colegioId)
    throw new BusinessError('CAJERO_SIN_COLEGIO', 'El cajero debe tener un colegio asignado', 422);
}

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly repo: Repository<Usuario>,
    private readonly ds: DataSource,
    private readonly bitacora: BitacoraService,
    private readonly sesiones: SesionesService,
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
      qb.andWhere(`(${coincide('u.username')} OR ${coincide("p.nombres || ' ' || p.apellidos")})`, {
        q: patron(f.q),
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
    validarColegioCajero(dto.rol, dto.colegioId);
    const problemas = problemasPassword(dto.password, dto.username);
    if (problemas.length)
      throw new BusinessError('PASSWORD_DEBIL', mensajePassword(problemas), 400);
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
          passwordHash: await bcrypt.hash(dto.password, BCRYPT_COSTO),
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
    validarColegioCajero(
      dto.rol ?? antes.rol,
      dto.colegioId !== undefined ? dto.colegioId : antes.colegioId,
    );
    await this.repo.update(id, dto);
    estadoUsuarioCache.invalidar(id);
    if (dto.activo === false) await this.sesiones.revocarTodas(id, 'USUARIO_DESACTIVADO');
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
    const u = await this.obtener(id);
    const problemas = problemasPassword(password, u.username);
    if (problemas.length)
      throw new BusinessError('PASSWORD_DEBIL', mensajePassword(problemas), 400);
    await this.repo.update(id, {
      passwordHash: await bcrypt.hash(password, BCRYPT_COSTO),
      debeCambiarPassword: true,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    // Quien tenía la contraseña anterior pierde el acceso de inmediato.
    await this.sesiones.revocarTodas(id, 'RESET_PASSWORD');
    estadoUsuarioCache.invalidar(id);
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
