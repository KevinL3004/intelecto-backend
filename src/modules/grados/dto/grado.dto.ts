import { Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export const NIVELES = ['PREPRIMARIA', 'PRIMARIA', 'BASICOS', 'DIVERSIFICADO'];

export class CrearGradoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) nombre: string;
  @ApiProperty({ enum: NIVELES }) @IsIn(NIVELES) nivel: string;
  @ApiProperty() @IsInt() @Min(0) @Max(9999) orden: number;
}

export class EditarGradoDto extends PartialType(CrearGradoDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}
