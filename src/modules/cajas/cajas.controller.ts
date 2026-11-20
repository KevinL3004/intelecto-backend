import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { Caja } from '../../database/entities';
import { toMoneyString } from '../../common/utils/money';
import { eliminarODesactivar } from '../../common/utils/soft-delete';
import { BitacoraService } from '../bitacora/bitacora.service';
import { CrearCajaDto, EditarCajaDto, FiltroCajasDto } from './dto/caja.dto';

@ApiTags('cajas')
@ApiBearerAuth()
@Controller('cajas')
export class CajasController {
  constructor(
    @InjectRepository(Caja) private readonly repo: Repository<Caja>,
    private readonly bitacora: BitacoraService,
  ) {}

  @Get()
  listar(@Query() f: FiltroCajasDto) {
    return this.repo.find({
      where: f.colegioId ? { colegioId: f.colegioId } : {},
      relations: { colegio: true },
      order: { colegioId: 'ASC', numero: 'ASC' },
    });
  }

  @Roles(Rol.ADMIN)
  @Post()
  async crear(@Body() dto: CrearCajaDto, @CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    const c = await this.repo.save(
      this.repo.create({ ...dto, fondoAsignado: toMoneyString(dto.fondoAsignado ?? 0) }),
    );
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'CREAR',
      entidad: 'caja',
      entidadId: c.id,
      despues: c,
      ip,
    });
    return c;
  }

  @Roles(Rol.ADMIN)
  @Patch(':id')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarCajaDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    const antes = await this.repo.findOneBy({ id });
    if (!antes) throw new NotFoundException('Caja no encontrada');
    const cambios = {
      ...dto,
      ...(dto.fondoAsignado ? { fondoAsignado: toMoneyString(dto.fondoAsignado) } : {}),
    };
    const despues = await this.repo.save({ ...antes, ...cambios });
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'EDITAR',
      entidad: 'caja',
      entidadId: id,
      antes,
      despues,
      ip,
    });
    return despues;
  }

  @Roles(Rol.ADMIN)
  @Delete(':id')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    const antes = await this.repo.findOneBy({ id });
    if (!antes) throw new NotFoundException('Caja no encontrada');
    const resultado = await eliminarODesactivar(this.repo, id, 'activa');
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: resultado,
      entidad: 'caja',
      entidadId: id,
      antes,
      ip,
    });
    return { resultado };
  }
}
