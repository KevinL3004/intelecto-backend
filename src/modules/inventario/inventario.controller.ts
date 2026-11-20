import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { colegioDelUsuario } from '../../common/utils/alcance';
import { InventarioService } from './inventario.service';
import {
  AjusteDto,
  FiltroInventarioDto,
  FiltroMovimientosDto,
  IngresoDto,
} from './dto/inventario.dto';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventario')
export class InventarioController {
  constructor(private readonly service: InventarioService) {}

  @Get()
  listar(@Query() f: FiltroInventarioDto, @CurrentUser() u: UsuarioActual) {
    return this.service.listar(
      colegioDelUsuario(u, f.colegioId),
      f.q?.trim() || undefined,
      f.soloConExistencia === 'true',
    );
  }

  @Get('movimientos')
  movimientos(@Query() f: FiltroMovimientosDto, @CurrentUser() u: UsuarioActual) {
    return this.service.movimientos({ ...f, colegioId: colegioDelUsuario(u, f.colegioId) });
  }

  /** Ingreso de mercadería: Admin y Contador. Los ajustes siguen siendo solo del Admin. */
  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post('ingreso')
  ingreso(@Body() dto: IngresoDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.ingreso(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Post('ajuste')
  ajuste(@Body() dto: AjusteDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.ajuste(dto, u.id, ip);
  }
}
