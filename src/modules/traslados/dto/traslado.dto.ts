import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ItemCantidadDto {
  @ApiProperty() @IsInt() libroId: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) cantidad: number;
}

export class CrearTrasladoDto {
  @ApiProperty() @IsInt() origenId: number;
  @ApiProperty() @IsInt() destinoId: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
  @ApiProperty({ type: [ItemCantidadDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ItemCantidadDto)
  items: ItemCantidadDto[];
  @ApiPropertyOptional({ description: 'Despachar de una vez (queda EN_TRANSITO)' })
  @IsOptional()
  @IsBoolean()
  despachar?: boolean;
}

export class ItemRecibidoDto {
  @ApiProperty() @IsInt() libroId: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) recibido: number;
}

export class RecibirTrasladoDto {
  @ApiProperty({ type: [ItemRecibidoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ItemRecibidoDto)
  items: ItemRecibidoDto[];
  @ApiPropertyOptional({ description: 'Obligatoria si se recibe menos de lo enviado' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  observacion?: string;
}

export class FiltroTrasladosDto extends PaginationDto {
  @IsOptional() @IsIn(['BORRADOR', 'EN_TRANSITO', 'RECIBIDO', 'CANCELADO']) estado?: string;
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
}

export class FiltroColegioDto {
  @IsOptional() @Type(() => Number) @IsInt() colegioId?: number;
}
