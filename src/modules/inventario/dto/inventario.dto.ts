import { EsId } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class FiltroInventarioDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) soloConExistencia?: 'true' | 'false';
}

export class FiltroMovimientosDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @Type(() => Number) @EsId() libroId?: number;
}

export class IngresoItemDto {
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty({ example: 25 }) @IsInt() @Min(1) @Max(100000) cantidad: number;
}

export class IngresoDto {
  @ApiProperty() @EsId() colegioId: number;
  @ApiPropertyOptional({ example: 'Factura 4521 Editorial X' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  referencia?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) motivo?: string;
  @ApiProperty({ type: [IngresoItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => IngresoItemDto)
  items: IngresoItemDto[];
}

export class AjusteDto {
  @ApiProperty() @EsId() colegioId: number;
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty({ description: 'Existencia física contada (valor final)' })
  @IsInt()
  @Min(0)
  @Max(1000000)
  existencia: number;
  @ApiProperty({ example: 'Conteo físico: 2 libros dañados' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El motivo del ajuste es obligatorio' })
  @MaxLength(250)
  motivo: string;
}
