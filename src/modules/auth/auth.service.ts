import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';
import { BusinessError } from '../../common/errors';
import { BCRYPT_COSTO, mensajePassword, problemasPassword } from '../../common/utils/password';
import { estadoUsuarioCache } from '../../common/guards/estado-usuario';
import { SesionesService } from './sesiones.service';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
/** Parámetros fijos del JWT de acceso: algoritmo, emisor y audiencia. */
export const JWT_OPCIONES = { algorithm: 'HS256' as const, issuer: 'svi-api', audience: 'svi-web' };

/**
 * Hash señuelo: si el usuario no existe se compara igual contra él, para que la respuesta
 * tarde lo mismo y no revele qué usuarios existen (enumeración por tiempo).
 */
const HASH_SENUELO = bcrypt.hashSync('usuario-inexistente-señuelo', BCRYPT_COSTO);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly bitacora: BitacoraService,
    private readonly sesiones: SesionesService,
  ) {}

  async login(username: string, password: string, ip: string, userAgent: string) {
    const u = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.persona', 'p')
      .leftJoinAndSelect('u.colegio', 'c')
      .where('lower(u.username) = lower(:username)', { username })
      .getOne();

    const invalido = new UnauthorizedException('Usuario o contraseña incorrectos');
    // Se compara siempre (aunque el usuario no exista) para no filtrar su existencia por tiempo.
    // Un usuario sin contraseña utilizable (p. ej. admin recién creado por el seed) nunca entra.
    const hashValido = !!u?.passwordHash && /^\$2[aby]\$\d{2}\$/.test(u.passwordHash);
    const ok =
      (await bcrypt.compare(password, hashValido ? u!.passwordHash : HASH_SENUELO)) && hashValido;
    if (!u || !u.activo) throw invalido;

    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) {
      throw new BusinessError(
        'USUARIO_BLOQUEADO',
        `Usuario bloqueado temporalmente. Intente después de ${MINUTOS_BLOQUEO} minutos.`,
        423,
      );
    }

    if (!ok) {
      const intentos = u.intentosFallidos + 1;
      const bloquear = intentos >= MAX_INTENTOS;
      await this.usuarios.update(u.id, {
        intentosFallidos: bloquear ? 0 : intentos,
        bloqueadoHasta: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) : null,
      });
      await this.bitacora.registrar({
        usuarioId: u.id,
        accion: bloquear ? 'USUARIO_BLOQUEADO' : 'LOGIN_FALLIDO',
        entidad: 'usuario',
        entidadId: u.id,
        ip,
      });
      throw invalido;
    }

    const cambios: Partial<Usuario> = {
      intentosFallidos: 0,
      bloqueadoHasta: null,
      ultimoAcceso: new Date(),
    };
    // Hashes antiguos (costo menor) se actualizan de forma transparente.
    if (bcrypt.getRounds(u.passwordHash) < BCRYPT_COSTO)
      cambios.passwordHash = await bcrypt.hash(password, BCRYPT_COSTO);
    await this.usuarios.update(u.id, cambios);

    const { sesionId, refreshToken } = await this.sesiones.crear(u.id, ip, userAgent);
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'LOGIN',
      entidad: 'usuario',
      entidadId: u.id,
      despues: { sesion: sesionId },
      ip,
    });
    return { ...(await this.tokens(u, sesionId, refreshToken)), usuario: this.perfilDe(u) };
  }

  /** Rota el refresh token: el anterior deja de servir (y reusarlo revoca la sesión). */
  async refresh(token: string, ip: string) {
    const r = await this.sesiones.rotar(token, ip);
    const u = await this.usuarios.findOne({
      where: { id: r.usuarioId },
      relations: { persona: true, colegio: true },
    });
    if (!u || !u.activo) {
      await this.sesiones.revocar(r.sesionId, 'USUARIO_DESACTIVADO');
      throw new UnauthorizedException('Usuario inactivo');
    }
    return { ...(await this.tokens(u, r.sesionId, r.refreshToken)), usuario: this.perfilDe(u) };
  }

  async logout(usuarioId: number, sesionId: string, ip: string) {
    await this.sesiones.revocar(sesionId, 'LOGOUT');
    await this.bitacora.registrar({
      usuarioId,
      accion: 'LOGOUT',
      entidad: 'sesion',
      entidadId: sesionId,
      ip,
    });
    return { ok: true };
  }

  async perfil(id: number) {
    const u = await this.usuarios.findOne({
      where: { id },
      relations: { persona: true, colegio: true },
    });
    if (!u) throw new UnauthorizedException();
    return this.perfilDe(u);
  }

  /** Cambia la contraseña y cierra las demás sesiones del usuario (la actual sigue). */
  async cambiarPassword(id: number, sesionId: string, actual: string, nueva: string, ip: string) {
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
    const problemas = problemasPassword(nueva, u.username);
    if (problemas.length)
      throw new BusinessError('PASSWORD_DEBIL', mensajePassword(problemas), 400);

    await this.usuarios.update(id, {
      passwordHash: await bcrypt.hash(nueva, BCRYPT_COSTO),
      debeCambiarPassword: false,
    });
    const cerradas = await this.sesiones.revocarTodas(id, 'CAMBIO_PASSWORD', sesionId);
    estadoUsuarioCache.invalidar(id);
    await this.bitacora.registrar({
      usuarioId: id,
      accion: 'CAMBIAR_PASSWORD',
      entidad: 'usuario',
      entidadId: id,
      despues: { sesionesCerradas: cerradas },
      ip,
    });
    return { ok: true };
  }

  async cambiarTema(id: number, tema: 'light' | 'dark' | 'system') {
    await this.usuarios.update(id, { tema });
    return { tema };
  }

  private async tokens(u: Usuario, sesionId: string, refreshToken: string) {
    const access_token = await this.jwt.signAsync(
      { sub: String(u.id), sid: sesionId, username: u.username, type: 'access' },
      {
        ...JWT_OPCIONES,
        secret: this.config.getOrThrow('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
      },
    );
    return { access_token, refresh_token: refreshToken };
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
