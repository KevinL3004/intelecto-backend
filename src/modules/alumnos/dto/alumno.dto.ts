import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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
  @ApiPropertyOptional() @IsOptional() @IsInt() colegioId?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() gradoId?: number;
  @ApiPropertyOptional({ description: 'Encargado al que se vincula' })
  @IsOptional()
  @IsInt()
  personaId?: number;
  @ApiPropertyOptional({ enum: PARENTESCOS })
  @IsOptional()
  @IsIn(PARENTESCOS)
  parentesco?: Parentesco;
}

export class EditarAlumnoDto extends PartialType(CrearAlumnoDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
}

export class VincularDto {
  @ApiProperty() @IsInt() personaId: number;
  @ApiPropertyOptional({ enum: PARENTESCOS })
  @IsOptional()
  @IsIn(PARENTESCOS)
  parentesco?: Parentesco;
}

export class FiltroAlumnosDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() gradoId?: number;
}
