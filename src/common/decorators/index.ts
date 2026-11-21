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
  /** Sesión del token (permite cerrarla en logout y revocar las demás al cambiar contraseña). */
  sesionId: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioActual => ctx.switchToHttp().getRequest().user,
);

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  // req.ip ya considera X-Forwarded-For solo desde el proxy de confianza (app.set('trust proxy', 1)).
  // Leer el encabezado directamente permitiría a cualquier cliente falsificar su IP en la bitácora.
  const req = ctx.switchToHttp().getRequest();
  return String(req.ip ?? '').slice(0, 45);
});
