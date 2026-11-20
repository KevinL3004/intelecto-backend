import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class CrearCajaDto {
  @ApiProperty() @IsInt() colegioId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) numero: number;
  @ApiPropertyOptional({ example: '500.00', description: 'Fondo (sencillo) asignado' })
  @IsOptional()
  @IsNumberString({}, { message: 'Fondo inválido' })
  fondoAsignado?: string;
}

export class EditarCajaDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(99) numero?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() fondoAsignado?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activa?: boolean;
}

export class FiltroCajasDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
}
