import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LineaVentaDto {
  @ApiProperty() @IsInt() libroId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) cantidad: number;
}

/** Licencia digital: letras, números y guiones (sin espacios raros ni caracteres de control). */
export const LICENCIA = /^[A-Za-z0-9][A-Za-z0-9._-]{2,59}$/;
const mayus = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;

/** Útiles de UN alumno dentro de la venta (un padre puede comprar para varios hijos). */
export class AlumnoVentaDto {
  @ApiPropertyOptional({ description: 'Alumno ya registrado' })
  @IsOptional()
  @IsInt()
  alumnoId?: number;
  @ApiPropertyOptional({ description: 'Alumno nuevo: se registra y se vincula al cliente' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nombres?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  apellidos?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() gradoId?: number;
  @ApiPropertyOptional({ description: 'Combo del grado: aplica su descuento si va completo' })
  @IsOptional()
  @IsInt()
  comboId?: number;
  @ApiPropertyOptional({ description: 'Número de licencia digital del sitio didáctico' })
  @IsOptional()
  @Transform(mayus)
  @Matches(LICENCIA, { message: 'Licencia inválida: use letras, números y guiones (3 a 60)' })
  licencia?: string;
  @ApiProperty({ type: [LineaVentaDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Agregue al menos un libro para cada alumno' })
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas: LineaVentaDto[];
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
  @ApiPropertyOptional({
    type: [LineaVentaDto],
    description: 'Venta sin alumnos (use esto O "alumnos", no ambos)',
  })
  @ValidateIf((o: CotizarVentaDto) => !o.alumnos)
  @IsArray()
  @ArrayMinSize(1, { message: 'Agregue al menos un libro' })
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas?: LineaVentaDto[];
  @ApiPropertyOptional({ type: [AlumnoVentaDto], description: 'Útiles agrupados por alumno' })
  @ValidateIf((o: CotizarVentaDto) => !o.lineas)
  @IsArray()
  @ArrayMinSize(1, { message: 'Agregue al menos un alumno' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AlumnoVentaDto)
  alumnos?: AlumnoVentaDto[];
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

export class LicenciaDto {
  @ApiProperty({ nullable: true, description: 'null para quitarla' })
  @Transform(mayus)
  @ValidateIf((o: LicenciaDto) => o.licencia !== null && o.licencia !== undefined)
  @Matches(LICENCIA, { message: 'Licencia inválida: use letras, números y guiones (3 a 60)' })
  licencia: string | null;
}

export class EnviarComprobanteDto {
  @ApiPropertyOptional({ description: 'Otro correo; por defecto, el del cliente' })
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Correo inválido' })
  @MaxLength(120)
  correo?: string;
  @ApiPropertyOptional({ description: 'Guardar este correo en los datos del cliente' })
  @IsOptional()
  @IsBoolean()
  guardarEnCliente?: boolean;
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
