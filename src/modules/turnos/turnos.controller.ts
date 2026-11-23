import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { TurnosService } from './turnos.service';
import {
  AbrirTurnoDto,
  CerrarTurnoDto,
  FiltroCajasDisponiblesDto,
  FiltroTurnosDto,
  MovimientoCajaDto,
  ValidarTurnoDto,
} from './dto/turno.dto';

@ApiTags('turnos')
@ApiBearerAuth()
@Controller()
export class TurnosController {
  constructor(private readonly service: TurnosService) {}

  @Get('denominaciones')
  denominaciones() {
    return this.service.denominaciones();
  }

  @Get('cajas/disponibles')
  cajasDisponibles(@Query() f: FiltroCajasDisponiblesDto, @CurrentUser() u: UsuarioActual) {
    return this.service.cajasDisponibles(u, f.colegioId);
  }

  @Get('turnos/actual')
  actual(@CurrentUser() u: UsuarioActual) {
    return this.service.actual(u.id).then((t) => ({ turno: t }));
  }

  @Get('turnos')
  listar(@Query() f: FiltroTurnosDto, @CurrentUser() u: UsuarioActual) {
    return this.service.listar(f, u);
  }

  @Get('turnos/:id/acta')
  acta(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual) {
    return this.service.acta(id, u);
  }

  @Post('turnos')
  abrir(@Body() dto: AbrirTurnoDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.abrir(dto, u, ip);
  }

  @Post('turnos/:id/iniciar-cierre')
  iniciarCierre(
    @ParamId('id') id: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.iniciarCierre(id, u, ip);
  }

  @Post('turnos/:id/cancelar-cierre')
  cancelarCierre(
    @ParamId('id') id: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.cancelarCierre(id, u, ip);
  }

  @Post('turnos/:id/cerrar')
  cerrar(
    @ParamId('id') id: number,
    @Body() dto: CerrarTurnoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.cerrar(id, dto, u, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post('turnos/:id/validar')
  validar(
    @ParamId('id') id: number,
    @Body() dto: ValidarTurnoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.validar(id, dto, u, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post('turnos/:id/movimientos')
  movimiento(
    @ParamId('id') id: number,
    @Body() dto: MovimientoCajaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.movimiento(id, dto, u, ip);
  }
}
