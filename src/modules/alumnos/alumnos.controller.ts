import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { AlumnosService } from './alumnos.service';
import { CrearAlumnoDto, EditarAlumnoDto, FiltroAlumnosDto, VincularDto } from './dto/alumno.dto';

@ApiTags('alumnos')
@ApiBearerAuth()
@Controller()
export class AlumnosController {
  constructor(private readonly service: AlumnosService) {}

  /** Búsqueda general de alumnos (datos de menores): solo Admin y Contador. */
  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Get('alumnos')
  listar(@Query() f: FiltroAlumnosDto) {
    return this.service.listar(f);
  }

  /** Alumnos del cliente que se está atendiendo (todos los roles, para vender). */
  @Get('personas/:id/alumnos')
  deEncargado(@ParamId('id') id: number) {
    return this.service.deEncargado(id);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Get('alumnos/:id')
  obtener(@ParamId('id') id: number) {
    return this.service.obtener(id);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post('alumnos')
  crear(@Body() dto: CrearAlumnoDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Patch('alumnos/:id')
  editar(
    @ParamId('id') id: number,
    @Body() dto: EditarAlumnoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.editar(id, dto, u.id, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Post('alumnos/:id/encargados')
  vincular(
    @ParamId('id') id: number,
    @Body() dto: VincularDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.vincular(id, dto, u.id, ip);
  }

  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Delete('alumnos/:id/encargados/:personaId')
  desvincular(
    @ParamId('id') id: number,
    @ParamId('personaId') personaId: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.desvincular(id, personaId, u.id, ip);
  }
}
