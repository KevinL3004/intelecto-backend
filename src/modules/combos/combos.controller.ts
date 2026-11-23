import { ParamId } from '../../common/validation/entrada';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { colegioDelUsuario } from '../../common/utils/alcance';
import { CombosService } from './combos.service';
import { CrearComboDto, EditarComboDto, FiltroCombosDto } from './dto/combo.dto';

@ApiTags('combos')
@ApiBearerAuth()
@Controller('combos')
export class CombosController {
  constructor(private readonly service: CombosService) {}

  /** Combos del colegio con sus libros y total calculado. Sin `ciclo` usa el vigente. */
  @Get()
  listar(@Query() f: FiltroCombosDto, @CurrentUser() u: UsuarioActual) {
    return this.service.listar(colegioDelUsuario(u, f.colegioId), f.ciclo, f.gradoId);
  }

  @Get(':id')
  async obtener(@ParamId('id') id: number, @CurrentUser() u: UsuarioActual) {
    const c = await this.service.obtener(id);
    if (u.rol === Rol.CAJERO && u.colegioId && c.colegioId !== u.colegioId)
      throw new ForbiddenException('Solo puede consultar su propio colegio');
    return c;
  }

  @Roles(Rol.ADMIN)
  @Post()
  crear(@Body() dto: CrearComboDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.service.crear(dto, u.id, ip);
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  editar(
    @ParamId('id') id: number,
    @Body() dto: EditarComboDto,
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
