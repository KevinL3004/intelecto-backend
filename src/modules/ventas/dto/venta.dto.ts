import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LineaVentaDto {
  @ApiProperty() @IsInt() libroId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) cantidad: number;
}

export class PagoDto {
  @ApiProperty() @IsInt() metodoPagoId: number;
  @ApiProperty({ example: '750.00', description: 'Monto base (sin recargo)' })
  @Matches(MONTO, { message: 'Monto inválido (máximo 2 decimales)' })
  montoBase: string;
  @ApiPropertyOptional({ description: 'Solo efectivo: lo que entrega el cliente' })
  @IsOptional()
  @Matches(MONTO, { message: 'Monto recibido inválido' })
  recibido?: string;
  @ApiPropertyOptional({ description: 'Autorización o referencia (tarjeta/transferencia)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  referencia?: string;
  @ApiPropertyOptional({ enum: ['TERMINAL', 'LINK_PAGO', 'OTRO'] })
  @IsOptional()
  @IsIn(['TERMINAL', 'LINK_PAGO', 'OTRO'])
  medio?: 'TERMINAL' | 'LINK_PAGO' | 'OTRO';
  @ApiPropertyOptional({ description: 'Recargo que se mostró al cajero, para detectar cambios' })
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/)
  recargoPct?: string;
}

export class CotizarVentaDto {
  @ApiPropertyOptional({ description: 'Por defecto, el colegio de la caja (DP-10)' })
  @IsOptional()
  @IsInt()
  colegioId?: number;
  @ApiPropertyOptional({ description: 'Combo de origen: aplica su descuento si va completo' })
  @IsOptional()
  @IsInt()
  comboId?: number;
  @ApiProperty({ type: [LineaVentaDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Agregue al menos un libro' })
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas: LineaVentaDto[];
  @ApiPropertyOptional({ description: 'true: se entrega ya; false: el cliente recoge después' })
  @IsOptional()
  @IsBoolean()
  entregarAhora?: boolean;
  @ApiPropertyOptional({ type: [PagoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos?: PagoDto[];
}

export class CrearVentaDto extends OmitType(CotizarVentaDto, ['pagos'] as const) {
  @ApiProperty() @IsInt() clienteId: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(150) alumno?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() gradoId?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
  @ApiProperty({ type: [PagoDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Registre al menos un pago' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos: PagoDto[];
}

export class EntregaItemDto {
  @ApiProperty() @IsInt() detalleId: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) cantidad: number;
}

export class EntregarDto {
  @ApiProperty({ type: [EntregaItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => EntregaItemDto)
  lineas: EntregaItemDto[];
}

export class AnularVentaDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(250)
  motivo: string;
  @ApiProperty({ description: '¿Los libros ya entregados regresan físicamente?' })
  @IsBoolean()
  devuelveLibros: boolean;
}

export class FiltroVentasDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() turnoId?: number;
  @IsOptional() @IsIn(['PAGADA', 'ANULADA']) estadoPago?: string;
  @IsOptional() @IsIn(['PENDIENTE', 'PARCIAL', 'COMPLETA']) estadoEntrega?: string;
  /** Ventas pagadas con libros por entregar (CU-10). El cajero ve las de su colegio. */
  @IsOptional() @IsIn(['true', 'false']) pendientesEntrega?: 'true' | 'false';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta?: string;
}
