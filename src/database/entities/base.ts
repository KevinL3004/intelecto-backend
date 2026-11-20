/**
 * BIGINT (oid 20) se convierte a number globalmente en database.module.ts
 * con pg.types.setTypeParser, por eso aquí solo declaramos el tipo.
 */
export const ID = { type: 'bigint' as const };
