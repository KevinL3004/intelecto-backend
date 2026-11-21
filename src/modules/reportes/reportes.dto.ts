import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros estándar de reportes (sección 10 del documento). */
export class FiltroReporteDto {
  @IsOptional() @Matches(FECHA) desde?: string;
  @IsOptional() @Matches(FECHA) hasta?: string;
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() cajaId?: number;
  @IsOptional() @Type(() => Number) @IsInt() usuarioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() metodoPagoId?: number;
  @IsOptional() @IsString() @MaxLength(30) estado?: string;
  @IsOptional() @IsString() @MaxLength(60) entidad?: string;
  @IsOptional() @IsIn(['json', 'xlsx']) formato?: 'json' | 'xlsx';
}

export const TIPOS = [
  'ventas',
  'metodos-pago',
  'libros',
  'pendientes',
  'alumnos',
  'cuadres',
  'existencias',
  'anuladas',
  'diferencias',
  'bitacora',
] as const;
export type TipoReporte = (typeof TIPOS)[number];
