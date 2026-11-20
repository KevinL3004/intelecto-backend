import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Rol } from '../roles';
import { FeatureName } from '../../config/features';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const FEATURE = 'feature';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Roles permitidos. Sin decorador = cualquier usuario autenticado. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);
/** Ruta disponible solo si la bandera de fase 2 está activa. */
export const Feature = (name: FeatureName) => SetMetadata(FEATURE, name);

export interface UsuarioActual {
  id: number;
  username: string;
  rol: Rol;
  colegioId: number | null;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioActual => ctx.switchToHttp().getRequest().user,
);

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim();
});
