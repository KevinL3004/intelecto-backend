import { ParamId } from '../../common/validation/entrada';
import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { LibrosService } from './libros.service';
import { CrearLibroDto, EditarLibroDto } from './dto/libro.dto';

@ApiTags('libros')
@ApiBearerAuth()
@Controller('libros')
export class LibrosController {
  constructor(private readonly service: LibrosService) {}

  @Get() listar(@Query() f: PaginationDto) {
    return this.service.listar(f);
  }

  @Get(':id') obtener(@ParamId('id') id: number) {
    return this.service.obtener(id);
  }

  @Roles(Rol.ADMIN)
  @Post()
  crear(@Body() dto: CrearLibroDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  editar(
    @ParamId('id') id: number,
    @Body() dto: EditarLibroDto,
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
