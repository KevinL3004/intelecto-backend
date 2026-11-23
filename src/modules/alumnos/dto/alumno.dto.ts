import { EsId, Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const PARENTESCOS = ['PADRE', 'MADRE', 'ENCARGADO', 'OTRO'] as const;
export type Parentesco = (typeof PARENTESCOS)[number];

export class CrearAlumnoDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) nombres: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  apellidos?: string;
  @ApiPropertyOptional() @IsOptional() @EsId() colegioId?: number;
  @ApiPropertyOptional() @IsOptional() @EsId() gradoId?: number;
  @ApiPropertyOptional({ description: 'Encargado al que se vincula' })
  @IsOptional()
  @EsId()
  personaId?: number;
  @ApiPropertyOptional({ enum: PARENTESCOS })
  @IsOptional()
  @IsIn(PARENTESCOS)
  parentesco?: Parentesco;
}

export class EditarAlumnoDto extends PartialType(CrearAlumnoDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}

export class VincularDto {
  @ApiProperty() @EsId() personaId: number;
  @ApiPropertyOptional({ enum: PARENTESCOS })
  @IsOptional()
  @IsIn(PARENTESCOS)
  parentesco?: Parentesco;
}

export class FiltroAlumnosDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @Type(() => Number) @EsId() gradoId?: number;
}
