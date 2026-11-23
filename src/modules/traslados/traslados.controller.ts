import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { TrasladosService } from './traslados.service';
import {
  CrearTrasladoDto,
  FiltroColegioDto,
  FiltroTrasladosDto,
  RecibirTrasladoDto,
} from './dto/traslado.dto';

/** Traslados entre colegios: Admin y Contador. */
@ApiTags('traslados')
@ApiBearerAuth()
@Roles(Rol.ADMIN, Rol.CONTADOR)
@Controller()
export class TrasladosController {
  constructor(private readonly service: TrasladosService) {}

  @Get('inventario/sugerencias-traslado')
  sugerencias(@Query() f: FiltroColegioDto) {
    return this.service.sugerencias(f.colegioId);
  }

  @Get('traslados')
  listar(@Query() f: FiltroTrasladosDto) {
    return this.service.listar(f);
  }

  @Get('traslados/:id')
  obtener(@ParamId('id') id: number) {
    return this.service.obtener(id);
  }

  @Post('traslados')
  crear(@Body() dto: CrearTrasladoDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u.id, ip);
  }

  @Post('traslados/:id/despachar')
  despachar(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.despachar(id, u.id, ip);
  }

  @Post('traslados/:id/recibir')
  recibir(
    @ParamId('id') id: number,
    @Body() dto: RecibirTrasladoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.recibir(id, dto, u.id, ip);
  }

  @Post('traslados/:id/cancelar')
  cancelar(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.cancelar(id, u.id, ip);
  }
}
