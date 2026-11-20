import { ObjectLiteral, QueryFailedError, Repository } from 'typeorm';

/**
 * RN-18: intenta borrar; si el registro tiene historial (FK), lo desactiva.
 */
export async function eliminarODesactivar<T extends ObjectLiteral>(
  repo: Repository<T>,
  id: number,
  campoActivo = 'activo',
): Promise<'ELIMINADO' | 'DESACTIVADO'> {
  try {
    await repo.delete(id);
    return 'ELIMINADO';
  } catch (e) {
    const code = (e as QueryFailedError & { code?: string }).code;
    if (e instanceof QueryFailedError && code === '23503') {
      await repo.update(id, { [campoActivo]: false } as never);
      return 'DESACTIVADO';
    }
    throw e;
  }
}
