import { EsId, Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class CrearCajaDto {
  @ApiProperty() @EsId() colegioId: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) numero: number;
  @ApiPropertyOptional({ example: '500.00', description: 'Fondo (sencillo) asignado' })
  @Opcional()
  @IsNumberString({}, { message: 'Fondo inválido' })
  fondoAsignado?: string;
}

export class EditarCajaDto {
  @ApiPropertyOptional() @Opcional() @IsInt() @Min(1) @Max(99) numero?: number;
  @ApiPropertyOptional() @Opcional() @IsNumberString() fondoAsignado?: string;
  @ApiPropertyOptional() @Opcional() @IsBoolean() activa?: boolean;
}

export class FiltroCajasDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
}
