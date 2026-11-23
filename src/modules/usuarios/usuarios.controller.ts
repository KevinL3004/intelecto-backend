import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UsuariosService } from './usuarios.service';
import { CrearUsuarioDto, EditarUsuarioDto, ResetPasswordDto } from './dto/usuario.dto';

class FiltroUsuariosDto extends PaginationDto {
  @IsOptional() @IsEnum(Rol) rol?: Rol;
}

@ApiTags('usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Get()
  listar(@Query() f: FiltroUsuariosDto) {
    return this.service.listar(f);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Get(':id')
  obtener(@ParamId('id') id: number) {
    return this.service.obtener(id);
  }

  @Roles(Rol.ADMIN)
  @Post()
  crear(@Body() dto: CrearUsuarioDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  editar(
    @ParamId('id') id: number,
    @Body() dto: EditarUsuarioDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.editar(id, dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Patch(':id/password')
  reset(
    @ParamId('id') id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.resetPassword(id, dto.password, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Delete(':id')
  desactivar(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.desactivar(id, u.id, ip);
  }
}
