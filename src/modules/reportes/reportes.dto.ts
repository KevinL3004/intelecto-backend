import { EsId } from '../../common/validation/entrada';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Estados válidos para filtrar (de venta, de línea o de turno, según el reporte). */
const ESTADOS_FILTRO = [
  ...['PENDIENTE_PAGO', 'PENDIENTE_VALIDACION', 'PAGADA', 'ANULADA', 'RECHAZADA', 'VENCIDA'],
  ...[
    'PENDIENTE_PROVEEDOR',
    'EN_PEDIDO',
    'PENDIENTE_TRASLADO',
    'EN_TRANSITO',
    'RESERVADO',
    'ENTREGADO',
    'ANULADO',
  ],
  ...['ABIERTO', 'EN_CIERRE', 'CERRADO', 'VALIDADO', 'OBSERVADO'],
];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros estándar de reportes (sección 10 del documento). */
export class FiltroReporteDto {
  @IsOptional() @Matches(FECHA) desde?: string;
  @IsOptional() @Matches(FECHA) hasta?: string;
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @Type(() => Number) @EsId() cajaId?: number;
  @IsOptional() @Type(() => Number) @EsId() usuarioId?: number;
  @IsOptional() @Type(() => Number) @EsId() metodoPagoId?: number;
  @IsOptional() @IsIn(ESTADOS_FILTRO) estado?: string;
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

export class FiltroAnalisisDto {
  @IsOptional() @Type(() => Number) @IsIn([7, 14, 30, 60, 90]) dias: number = 30;
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
}
