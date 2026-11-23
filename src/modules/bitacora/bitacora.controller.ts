import { EsId } from '../../common/validation/entrada';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Roles } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BitacoraService } from './bitacora.service';

class FiltroBitacoraDto extends PaginationDto {
  @IsOptional() @IsString() entidad?: string;
  @IsOptional() @Type(() => Number) @EsId() usuarioId?: number;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
}

@ApiTags('bitacora')
@ApiBearerAuth()
@Roles(Rol.ADMIN, Rol.CONTADOR)
@Controller('bitacora')
export class BitacoraController {
  constructor(private readonly service: BitacoraService) {}

  @Get()
  listar(@Query() f: FiltroBitacoraDto) {
    return this.service.listar(f);
  }
}
