import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IS_PUBLIC } from '../decorators';
import { estadoUsuarioCache, EstadoUsuario } from './estado-usuario';
import { SesionesService } from '../../modules/auth/sesiones.service';
import { JWT_OPCIONES } from '../../modules/auth/auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
    private readonly sesiones: SesionesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Token no enviado');

    let payload: { sub: string; sid: string; username: string; type: string };
    try {
      // Algoritmo, emisor y audiencia fijos: evita aceptar tokens firmados de otra forma.
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
        algorithms: [JWT_OPCIONES.algorithm],
        issuer: JWT_OPCIONES.issuer,
        audience: JWT_OPCIONES.audience,
      });
      if (payload.type !== 'access' || !payload.sid) throw new Error('tipo');
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    // La sesión debe seguir vigente (logout, cambio de contraseña o reúso de refresh la revocan).
    if (!(await this.sesiones.activa(payload.sid)))
      throw new UnauthorizedException('Sesión cerrada');

    // Rol y colegio se toman de la BD (no del token) para que los cambios apliquen al instante.
    const id = Number(payload.sub);
    const estado = await this.estado(id);
    if (!estado?.activo) throw new UnauthorizedException('Usuario inactivo');
    req.user = {
      id,
      username: payload.username,
      rol: estado.rol,
      colegioId: estado.colegioId,
      sesionId: payload.sid,
    };
    return true;
  }

  private async estado(id: number): Promise<EstadoUsuario | undefined> {
    const enCache = estadoUsuarioCache.leer(id);
    if (enCache) return enCache;
    const [fila]: EstadoUsuario[] = await this.ds.query(
      'SELECT activo, rol, colegio_id AS "colegioId" FROM usuario WHERE id = $1',
      [id],
    );
    if (fila) estadoUsuarioCache.guardar(id, fila);
    return fila;
  }
}
