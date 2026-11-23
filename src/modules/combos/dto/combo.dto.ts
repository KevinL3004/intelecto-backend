import { EsId, Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

export class FiltroCombosDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) ciclo?: number;
  @IsOptional() @Type(() => Number) @EsId() gradoId?: number;
}

export class ComboLibroDto {
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) cantidad: number;
}

export class CrearComboDto {
  @ApiProperty() @EsId() colegioId: number;
  @ApiProperty() @EsId() gradoId: number;
  @ApiPropertyOptional({ description: 'Por defecto, el ciclo vigente' })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  ciclo?: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) nombre: string;
  @ApiPropertyOptional({ example: '50.00' })
  @IsOptional()
  @Matches(MONTO, { message: 'Descuento inválido (máximo 2 decimales)' })
  descuento?: string;
  @ApiProperty({ type: [ComboLibroDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'El combo debe tener al menos un libro' })
  @ArrayMaxSize(60)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ComboLibroDto)
  libros: ComboLibroDto[];
}

export class EditarComboDto {
  @ApiPropertyOptional() @Opcional() @IsString() @IsNotEmpty() @MaxLength(120) nombre?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(MONTO, { message: 'Descuento inválido (máximo 2 decimales)' })
  descuento?: string;
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
  @ApiPropertyOptional({ type: [ComboLibroDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'El combo debe tener al menos un libro' })
  @ArrayMaxSize(60)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ComboLibroDto)
  libros?: ComboLibroDto[];
}
