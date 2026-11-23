import { Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const vacioANull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CrearLibroDto {
  @ApiPropertyOptional({ example: '978-9929-123-45-6' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() || null : value,
  )
  @Matches(/^[0-9X-]{10,20}$/, { message: 'ISBN inválido (10 a 20 dígitos/guiones)' })
  isbn?: string | null;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) titulo: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(vacioANull)
  @IsString()
  @MaxLength(120)
  editorial?: string | null;
}

export class EditarLibroDto extends PartialType(CrearLibroDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}
