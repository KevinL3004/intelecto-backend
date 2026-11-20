import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { colegioDelUsuario } from '../../common/utils/alcance';
import { PreciosService } from './precios.service';
import { CopiarPreciosDto, FiltroPreciosDto, GuardarPreciosDto } from './dto/precio.dto';

@ApiTags('precios')
@ApiBearerAuth()
@Controller('precios')
export class PreciosController {
  constructor(private readonly service: PreciosService) {}

  /** Lista de precios del colegio. Sin `ciclo` usa el ciclo vigente. */
  @Get()
  listar(@Query() f: FiltroPreciosDto, @CurrentUser() u: UsuarioActual) {
    return this.service.listar(colegioDelUsuario(u, f.colegioId), f.ciclo);
  }

  @Roles(Rol.ADMIN)
  @Put()
  guardar(@Body() dto: GuardarPreciosDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.guardar(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Post('copiar')
  copiar(@Body() dto: CopiarPreciosDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.copiar(dto, u.id, ip);
  }
}
