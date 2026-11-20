import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UsuarioActual } from '../decorators';
import { Rol } from '../roles';
import { Parametro } from '../../database/entities';

/**
 * Colegio sobre el que puede operar el usuario.
 * El cajero (con colegio asignado) solo ve el suyo; Admin y Contador eligen cualquiera.
 */
export function colegioDelUsuario(u: UsuarioActual, solicitado?: number): number {
  if (u.rol === Rol.CAJERO && u.colegioId) {
    if (solicitado && solicitado !== u.colegioId)
      throw new ForbiddenException('Solo puede consultar su propio colegio');
    return u.colegioId;
  }
  if (!solicitado) throw new BadRequestException('Debe indicar el colegio');
  return solicitado;
}

/** Ciclo escolar vigente (parámetro `ciclo_actual`). */
export async function cicloActual(m: EntityManager): Promise<number> {
  const p = await m.getRepository(Parametro).findOneBy({ clave: 'ciclo_actual' });
  const ciclo = Number(p?.valor);
  return Number.isInteger(ciclo) ? ciclo : new Date().getFullYear();
}
