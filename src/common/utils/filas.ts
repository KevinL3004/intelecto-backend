/**
 * Con PostgreSQL, TypeORM devuelve `[filas, cantidad]` (no solo las filas) para
 * `UPDATE … RETURNING` y `DELETE … RETURNING`. Esta función devuelve siempre las filas.
 */
export function filas<T>(r: unknown): T[] {
  if (Array.isArray(r) && r.length === 2 && Array.isArray(r[0]) && typeof r[1] === 'number')
    return r[0] as T[];
  return r as T[];
}
