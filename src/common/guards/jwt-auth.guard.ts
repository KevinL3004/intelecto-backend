import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IS_PUBLIC } from '../decorators';
import { estadoUsuarioCache, EstadoUsuario } from './estado-usuario';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
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

    let payload: { sub: string; username: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      if (payload.type !== 'access') throw new Error('tipo');
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // Rol y colegio se toman de la BD (no del token) para que los cambios apliquen al instante.
    const id = Number(payload.sub);
    const estado = await this.estado(id);
    if (!estado?.activo) throw new UnauthorizedException('Usuario inactivo');
    req.user = { id, username: payload.username, rol: estado.rol, colegioId: estado.colegioId };
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
