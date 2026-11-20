import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const NIVELES = ['PREPRIMARIA', 'PRIMARIA', 'BASICOS', 'DIVERSIFICADO'];

export class CrearGradoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) nombre: string;
  @ApiProperty({ enum: NIVELES }) @IsIn(NIVELES) nivel: string;
  @ApiProperty() @IsInt() @Min(0) orden: number;
}

export class EditarGradoDto extends PartialType(CrearGradoDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
}
