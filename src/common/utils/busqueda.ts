/**
 * Búsqueda sin tildes ni mayúsculas (requiere f_norm, migración V003).
 * Uso: qb.andWhere(`(${coincide('l.titulo')} OR ${coincide('l.isbn')})`, { q: patron(texto) })
 */
export const patron = (texto: string) => `%${texto.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** Expresión SQL: la columna (normalizada) contiene el parámetro `param` (normalizado). */
export const coincide = (columna: string, param = ':q') =>
  `f_norm(coalesce(${columna}, '')) LIKE f_norm(${param})`;
