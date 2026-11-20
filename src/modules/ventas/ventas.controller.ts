import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { VentasService } from './ventas.service';
import {
  AnularVentaDto,
  CotizarVentaDto,
  CrearVentaDto,
  EntregarDto,
  FiltroVentasDto,
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
  obtener(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: UsuarioActual) {
    return this.service.obtener(id, u);
  }

  @Post(':id/entregas')
  entregar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EntregarDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.entregar(id, dto, u, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post(':id/anular')
  anular(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnularVentaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.anular(id, dto, u, ip);
  }
}
