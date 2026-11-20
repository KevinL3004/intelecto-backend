import { Rol } from '../roles';

export interface EstadoUsuario {
  activo: boolean;
  rol: Rol;
  colegioId: number | null;
}

const TTL_MS = 30_000;
const cache = new Map<number, { estado: EstadoUsuario; vence: number }>();

/**
 * Caché corto del estado real del usuario (activo, rol, colegio).
 * El guard lo usa en cada petición para que desactivar o cambiar el rol aplique
 * de inmediato, sin esperar a que venza el token.
 */
export const estadoUsuarioCache = {
  leer(id: number): EstadoUsuario | undefined {
    const e = cache.get(id);
    if (!e || e.vence < Date.now()) return undefined;
    return e.estado;
  },
  guardar(id: number, estado: EstadoUsuario) {
    cache.set(id, { estado, vence: Date.now() + TTL_MS });
  },
  /** Llamar al editar o desactivar un usuario. */
  invalidar(id: number) {
    cache.delete(id);
  },
};
