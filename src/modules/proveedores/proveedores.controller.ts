import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { FiltroColegioDto } from '../traslados/dto/traslado.dto';
import { ProveedoresService } from './proveedores.service';
import {
  CrearPedidoDto,
  CrearProveedorDto,
  EditarProveedorDto,
  FiltroPedidosDto,
  RecepcionDto,
} from './dto/proveedor.dto';

/** Proveedores y pedidos a proveedor: Admin y Contador. */
@ApiTags('proveedores')
@ApiBearerAuth()
@Roles(Rol.ADMIN, Rol.CONTADOR)
@Controller()
export class ProveedoresController {
  constructor(private readonly service: ProveedoresService) {}

  @Get('proveedores')
  listar(@Query() f: PaginationDto) {
    return this.service.listar(f);
  }

  @Post('proveedores')
  crear(@Body() dto: CrearProveedorDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crearProveedor(dto, u.id, ip);
  }

  @Patch('proveedores/:id')
  editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarProveedorDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.editarProveedor(id, dto, u.id, ip);
  }

  @Delete('proveedores/:id')
  eliminar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.eliminarProveedor(id, u.id, ip);
  }

  @Get('inventario/por-pedir')
  porPedir(@Query() f: FiltroColegioDto) {
    return this.service.porPedir(f.colegioId);
  }

  @Get('pedidos-proveedor')
  pedidos(@Query() f: FiltroPedidosDto) {
    return this.service.pedidos(f);
  }

  @Get('pedidos-proveedor/:id')
  pedido(@Param('id', ParseIntPipe) id: number) {
    return this.service.pedido(id);
  }

  @Post('pedidos-proveedor')
  crearPedido(
    @Body() dto: CrearPedidoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.crearPedido(dto, u.id, ip);
  }

  @Post('pedidos-proveedor/:id/recepciones')
  recepcion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecepcionDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.recepcion(id, dto, u.id, ip);
  }

  @Post('pedidos-proveedor/:id/cancelar')
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.cancelarPedido(id, u.id, ip);
  }
}
