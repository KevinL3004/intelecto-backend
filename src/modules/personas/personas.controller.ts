import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PersonasService } from './personas.service';
import { CrearPersonaDto, EditarPersonaDto } from './dto/persona.dto';

@ApiTags('personas')
@ApiBearerAuth()
@Controller('personas')
export class PersonasController {
  constructor(private readonly service: PersonasService) {}

  /** Todos los roles buscan clientes para vender. */
  @Get() listar(@Query() f: PaginationDto) {
    return this.service.listar(f);
  }

  @Get(':id') obtener(@ParamId('id') id: number) {
    return this.service.obtener(id);
  }

  /** Todos los roles pueden registrar un cliente nuevo al vender. */
  @Post() crear(
    @Body() dto: CrearPersonaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.crear(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  editar(
    @ParamId('id') id: number,
    @Body() dto: EditarPersonaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    return this.service.editar(id, dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Delete(':id')
  eliminar(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.eliminar(id, u.id, ip);
  }
}
