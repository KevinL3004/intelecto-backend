import { Body, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { ClientIp, CurrentUser, Public, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { featuresSnapshot } from '../../config/features';
import { Parametro } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';

class ParametroDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250) valor: string;
}

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(
    @InjectRepository(Parametro) private readonly repo: Repository<Parametro>,
    private readonly bitacora: BitacoraService,
  ) {}

  /** El frontend lo usa para mostrar u ocultar módulos de fase 2. */
  @Public()
  @Get('features')
  features() {
    return featuresSnapshot();
  }

  @ApiBearerAuth()
  @Get('parametros')
  parametros() {
    return this.repo.find({ order: { clave: 'ASC' } });
  }

  @ApiBearerAuth()
  @Roles(Rol.ADMIN)
  @Patch('parametros/:clave')
  async editar(
    @Param('clave') clave: string,
    @Body() dto: ParametroDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    const antes = await this.repo.findOneBy({ clave });
    if (!antes) throw new NotFoundException('Parámetro no encontrado');
    await this.repo.update(clave, { valor: dto.valor });
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'CONFIG',
      entidad: 'parametro',
      entidadId: clave,
      antes: { valor: antes.valor },
      despues: dto,
      ip,
    });
    return this.repo.findOneBy({ clave });
  }
}
