export type TipoColumna = 'texto' | 'entero' | 'dinero' | 'fecha' | 'fechaHora';

export interface Columna {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
}

export interface Reporte {
  titulo: string;
  columnas: Columna[];
  filas: Record<string, unknown>[];
  /** Totales al pie (solo columnas numéricas). */
  totales: Record<string, string | number>;
  /** true si se recortaron filas por el límite de pantalla. */
  recortado: boolean;
}

export const c = (clave: string, titulo: string, tipo: TipoColumna = 'texto'): Columna => ({
  clave,
  titulo,
  tipo,
});
