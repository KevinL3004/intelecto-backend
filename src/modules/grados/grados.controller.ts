import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { Grado } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearGradoDto, EditarGradoDto } from './dto/grado.dto';

/** Catálogo pequeño: la lógica cabe en el controlador (KISS). */
@ApiTags('grados')
@ApiBearerAuth()
@Controller('grados')
export class GradosController {
  constructor(
    @InjectRepository(Grado) private readonly repo: Repository<Grado>,
    private readonly bitacora: BitacoraService,
  ) {}

  @Get() listar() {
    return this.repo.find({ order: { orden: 'ASC' } });
  }

  @Roles(Rol.ADMIN)
  @Post()
  async crear(@Body() dto: CrearGradoDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    const g = await this.repo.save(this.repo.create(dto));
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'CREAR',
      entidad: 'grado',
      entidadId: g.id,
      despues: g,
      ip,
    });
    return g;
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarGradoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    const antes = await this.repo.findOneBy({ id });
    if (!antes) throw new NotFoundException('Grado no encontrado');
    const despues = await this.repo.save({ ...antes, ...dto });
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'EDITAR',
      entidad: 'grado',
      entidadId: id,
      antes,
      despues,
      ip,
    });
    return despues;
  }
}
