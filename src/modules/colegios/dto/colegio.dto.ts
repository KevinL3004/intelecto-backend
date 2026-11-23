import { Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CrearColegioDto {
  @ApiProperty({ example: 'COL-001' })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'Código: 2 a 20 caracteres (letras, números, guion)' })
  codigo: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) nombre: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) direccion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telefono?: string;
}

export class EditarColegioDto extends PartialType(CrearColegioDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}
