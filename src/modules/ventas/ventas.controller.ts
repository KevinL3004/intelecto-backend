import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { VentasService } from './ventas.service';
import {
  AnularVentaDto,
  CotizarVentaDto,
  CrearVentaDto,
  EntregarDto,
  EnviarComprobanteDto,
  FiltroVentasDto,
  LicenciaDto,
} from './dto/venta.dto';

@ApiTags('ventas')
@ApiBearerAuth()
@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  /** Calcula líneas, disponibilidad, recargos y vuelto. No guarda nada. */
  @Post('cotizar')
  @HttpCode(200)
  cotizar(@Body() dto: CotizarVentaDto, @CurrentUser() u: UsuarioActual) {
    return this.service.cotizar(dto, u);
  }

  @Post()
  crear(@Body() dto: CrearVentaDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u, ip);
  }

  /** Admin/Contador: todas. Cajero: las propias (o las pendientes de entrega de su colegio). */
  @Get()
  listar(@Query() f: FiltroVentasDto, @CurrentUser() u: UsuarioActual) {
    return this.service.listar(f, u);
  }

  @Get(':id')
  obtener(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual) {
    return this.service.obtener(id, u);
  }

  /** Comprobante para imprimir (ticket térmico 80 mm), agrupado por alumno. */
  @Get(':id/comprobante')
  comprobante(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual) {
    return this.service.comprobante(id, u);
  }

  /** Envía (o reenvía) el comprobante por correo. Limitado para evitar abuso como spam. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/comprobante/correo')
  @HttpCode(202)
  enviarComprobante(
    @ParamId('id') id: number,
    @Body() dto: EnviarComprobanteDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.enviarComprobante(id, dto, u, ip);
  }

  /** Corrige la licencia digital de un alumno de la venta. */
  @Patch(':id/alumnos/:ventaAlumnoId/licencia')
  editarLicencia(
    @ParamId('id') id: number,
    @ParamId('ventaAlumnoId') ventaAlumnoId: number,
    @Body() dto: LicenciaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.editarLicencia(id, ventaAlumnoId, dto, u, ip);
  }

  @Post(':id/entregas')
  entregar(
    @ParamId('id') id: number,
    @Body() dto: EntregarDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.entregar(id, dto, u, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post(':id/anular')
  anular(
    @ParamId('id') id: number,
    @Body() dto: AnularVentaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.anular(id, dto, u, ip);
  }
}
