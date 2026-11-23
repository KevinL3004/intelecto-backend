import { EsId } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
  IsObject,
} from 'class-validator';

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

export class FiltroPreciosDto {
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) ciclo?: number;
}

export class PrecioItemDto {
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty({ example: '125.50', nullable: true, description: 'null quita el precio' })
  @ValidateIf((o) => o.precio !== null)
  @Matches(MONTO, { message: 'Precio inválido (máximo 2 decimales)' })
  precio: string | null;
}

export class GuardarPreciosDto {
  @ApiProperty() @EsId() colegioId: number;
  @ApiProperty({ example: 2027 }) @IsInt() @Min(2000) @Max(2100) ciclo: number;
  @ApiProperty({ type: [PrecioItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PrecioItemDto)
  items: PrecioItemDto[];
}

export class CopiarPreciosDto {
  @ApiProperty() @EsId() colegioOrigenId: number;
  @ApiProperty() @IsInt() @Min(2000) @Max(2100) cicloOrigen: number;
  @ApiProperty() @EsId() colegioDestinoId: number;
  @ApiProperty() @IsInt() @Min(2000) @Max(2100) cicloDestino: number;
  @ApiPropertyOptional({ description: 'Reemplazar precios que ya existan en el destino' })
  @IsOptional()
  @IsBoolean()
  sobrescribir?: boolean;
}
