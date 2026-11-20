import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Texto vacío = quitar el dato (se guarda null). */
const vacioANull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  return v === '' ? null : v;
};
const upperNit = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]/g, '') : value;

export class CrearPersonaDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Los nombres son obligatorios' })
  @MaxLength(100)
  nombres: string;
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidos?: string;
  @ApiPropertyOptional({ example: 'CF' })
  @Transform(upperNit)
  @IsOptional()
  @Matches(/^(CF|\d{1,12}K?)$/, {
    message: 'NIT inválido (use CF o solo números, con K al final si aplica)',
  })
  nit?: string;
  @ApiPropertyOptional()
  @Transform(vacioANull)
  @IsOptional()
  @Matches(/^\d{13}$/, { message: 'El DPI debe tener 13 dígitos' })
  dpi?: string | null;
  @ApiPropertyOptional()
  @Transform(vacioANull)
  @IsOptional()
  @Matches(/^[\d+\s-]{8,20}$/, { message: 'Teléfono inválido' })
  telefono?: string | null;
  @ApiPropertyOptional()
  @Transform(vacioANull)
  @IsOptional()
  @IsEmail({}, { message: 'Correo inválido' })
  @MaxLength(120)
  correo?: string | null;
}

export class EditarPersonaDto extends PartialType(CrearPersonaDto) {}
