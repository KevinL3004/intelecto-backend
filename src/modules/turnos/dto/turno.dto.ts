import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

export class ConteoItemDto {
  @ApiProperty() @IsInt() denominacionId: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) cantidad: number;
}

export class AbrirTurnoDto {
  @ApiProperty() @IsInt() cajaId: number;
  @ApiProperty({ type: [ConteoItemDto], description: 'Fondo inicial por denominación' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ConteoItemDto)
  conteo: ConteoItemDto[];
  @ApiPropertyOptional({ description: 'Obligatoria si el fondo no coincide con el asignado' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
}

export class CerrarTurnoDto {
  @ApiPropertyOptional({
    type: [ConteoItemDto],
    description: 'Conteo ciego por denominación (se registra una sola vez)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ConteoItemDto)
  conteo?: ConteoItemDto[];
  @ApiPropertyOptional({ description: 'Obligatoria si hay diferencia o es cierre forzado' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
}

export class ValidarTurnoDto {
  @ApiProperty({ enum: ['VALIDADO', 'OBSERVADO'] })
  @IsIn(['VALIDADO', 'OBSERVADO'])
  resultado: 'VALIDADO' | 'OBSERVADO';
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
}

export class MovimientoCajaDto {
  @ApiProperty({ enum: ['RETIRO', 'INGRESO'] }) @IsIn(['RETIRO', 'INGRESO']) tipo:
    | 'RETIRO'
    | 'INGRESO';
  @ApiProperty({ example: '1000.00' })
  @Matches(MONTO, { message: 'Monto inválido (máximo 2 decimales)' })
  monto: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(250)
  motivo: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) referencia?: string;
}

export class FiltroTurnosDto extends PaginationDto {
  @IsOptional()
  @IsIn(['ABIERTO', 'EN_CIERRE', 'CERRADO', 'VALIDADO', 'OBSERVADO'])
  estado?: string;
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
}

export class FiltroCajasDisponiblesDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
}
