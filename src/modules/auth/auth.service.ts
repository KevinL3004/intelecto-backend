import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';
import { BusinessError } from '../../common/errors';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly bitacora: BitacoraService,
  ) {}

  async login(username: string, password: string, ip: string) {
    const u = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.persona', 'p')
      .where('lower(u.username) = lower(:username)', { username })
      .getOne();

    const invalido = new UnauthorizedException('Usuario o contraseña incorrectos');
    if (!u || !u.activo) throw invalido;

    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) {
      throw new BusinessError(
        'USUARIO_BLOQUEADO',
        `Usuario bloqueado temporalmente. Intente después de ${MINUTOS_BLOQUEO} minutos.`,
        423,
      );
    }

    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      const intentos = u.intentosFallidos + 1;
      const bloquear = intentos >= MAX_INTENTOS;
      await this.usuarios.update(u.id, {
        intentosFallidos: bloquear ? 0 : intentos,
        bloqueadoHasta: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) : null,
      });
      await this.bitacora.registrar({
        usuarioId: u.id,
        accion: 'LOGIN_FALLIDO',
        entidad: 'usuario',
        entidadId: u.id,
        ip,
      });
      throw invalido;
    }

    await this.usuarios.update(u.id, {
      intentosFallidos: 0,
      bloqueadoHasta: null,
      ultimoAcceso: new Date(),
    });
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'LOGIN',
      entidad: 'usuario',
      entidadId: u.id,
      ip,
    });
    return { ...(await this.emitirTokens(u)), usuario: this.perfilDe(u) };
  }

  async refresh(token: string) {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      if (payload.type !== 'refresh') throw new Error();
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    const u = await this.usuarios.findOne({
      where: { id: Number(payload.sub) },
      relations: { persona: true },
    });
    if (!u || !u.activo) throw new UnauthorizedException('Usuario inactivo');
    return { ...(await this.emitirTokens(u)), usuario: this.perfilDe(u) };
  }

  async perfil(id: number) {
    const u = await this.usuarios.findOne({
      where: { id },
      relations: { persona: true, colegio: true },
    });
    if (!u) throw new UnauthorizedException();
    return this.perfilDe(u);
  }

  async cambiarPassword(id: number, actual: string, nueva: string, ip: string) {
    const u = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id })
      .getOne();
    if (!u || !(await bcrypt.compare(actual, u.passwordHash))) {
      throw new BusinessError('PASSWORD_INCORRECTA', 'La contraseña actual no es correcta', 400);
    }
    if (actual === nueva)
      throw new BusinessError('PASSWORD_IGUAL', 'La nueva contraseña debe ser distinta', 400);
    await this.usuarios.update(id, {
      passwordHash: await bcrypt.hash(nueva, 10),
      debeCambiarPassword: false,
    });
    await this.bitacora.registrar({
      usuarioId: id,
      accion: 'CAMBIAR_PASSWORD',
      entidad: 'usuario',
      entidadId: id,
      ip,
    });
    return { ok: true };
  }

  async cambiarTema(id: number, tema: 'light' | 'dark' | 'system') {
    await this.usuarios.update(id, { tema });
    return { tema };
  }

  private async emitirTokens(u: Usuario) {
    const base = { sub: String(u.id), username: u.username, rol: u.rol, colegioId: u.colegioId };
    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(
        { ...base, type: 'access' },
        {
          secret: this.config.getOrThrow('JWT_SECRET'),
          expiresIn: this.config.get('JWT_EXPIRES_IN', '1h'),
        },
      ),
      this.jwt.signAsync(
        { sub: base.sub, type: 'refresh' },
        {
          secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
        },
      ),
    ]);
    return { access_token, refresh_token };
  }

  private perfilDe(u: Usuario) {
    return {
      id: u.id,
      username: u.username,
      nombre: u.persona ? `${u.persona.nombres} ${u.persona.apellidos}`.trim() : u.username,
      rol: u.rol,
      colegioId: u.colegioId,
      colegio: u.colegio?.nombre ?? null,
      debeCambiarPassword: u.debeCambiarPassword,
      tema: u.tema,
    };
  }
}
