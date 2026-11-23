import { EsId, Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const vacioANull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CrearProveedorDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) nombre: string;
  @ApiPropertyOptional()
  @Transform(vacioANull)
  @IsOptional()
  @Matches(/^(CF|\d{1,12}K?)$/i, { message: 'NIT inválido' })
  nit?: string | null;
  @ApiPropertyOptional()
  @Transform(vacioANull)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contacto?: string | null;
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

export class EditarProveedorDto extends PartialType(CrearProveedorDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}

export class ItemPedidoDto {
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) solicitado: number;
}

export class CrearPedidoDto {
  @ApiProperty() @EsId() proveedorId: number;
  @ApiProperty() @EsId() colegioDestinoId: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  observacion?: string;
  @ApiProperty({ type: [ItemPedidoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items: ItemPedidoDto[];
}

export class ItemRecepcionDto {
  @ApiProperty() @EsId() libroId: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) cantidad: number;
}

export class RecepcionDto {
  @ApiProperty({ type: [ItemRecepcionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ItemRecepcionDto)
  items: ItemRecepcionDto[];
  @ApiPropertyOptional({ example: 'Factura 8812' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  referencia?: string;
}

export class FiltroPedidosDto extends PaginationDto {
  @IsOptional() @IsIn(['SOLICITADO', 'PARCIAL', 'RECIBIDO', 'CANCELADO']) estado?: string;
  @IsOptional() @Type(() => Number) @EsId() colegioId?: number;
}
