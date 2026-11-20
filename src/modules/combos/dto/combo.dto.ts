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
} from 'class-validator';

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

export class FiltroCombosDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) ciclo?: number;
  @IsOptional() @Type(() => Number) @IsInt() gradoId?: number;
}

export class ComboLibroDto {
  @ApiProperty() @IsInt() libroId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) cantidad: number;
}

export class CrearComboDto {
  @ApiProperty() @IsInt() colegioId: number;
  @ApiProperty() @IsInt() gradoId: number;
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
  @ValidateNested({ each: true })
  @Type(() => ComboLibroDto)
  libros: ComboLibroDto[];
}

export class EditarComboDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nombre?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(MONTO, { message: 'Descuento inválido (máximo 2 decimales)' })
  descuento?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
  @ApiPropertyOptional({ type: [ComboLibroDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'El combo debe tener al menos un libro' })
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ComboLibroDto)
  libros?: ComboLibroDto[];
}
