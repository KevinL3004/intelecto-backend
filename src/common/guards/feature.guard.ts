import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE } from '../decorators';
import { FeatureName, isFeatureEnabled } from '../../config/features';

/** Si la funcionalidad de fase 2 está apagada, la ruta responde 404 (como si no existiera). */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const name = this.reflector.getAllAndOverride<FeatureName>(FEATURE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (name && !isFeatureEnabled(name)) throw new NotFoundException();
    return true;
  }
}
