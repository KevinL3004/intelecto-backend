import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { ClientIp, CurrentUser, Public, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { featuresSnapshot } from '../../config/features';
import { Parametro } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';

class ParametroDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(250)
  valor: string;
}

/** Datos del comprobante que pueden quedar vacíos (no se imprimen). */
const OPCIONALES = new Set([
  'direccion_empresa',
  'telefono_empresa',
  'correo_empresa',
  'sitio_licencias',
  'pie_comprobante',
  'nit_empresa',
]);
/** Parámetros numéricos (ciclo, días, montos). */
const NUMERICOS: Record<string, RegExp> = {
  ciclo_actual: /^20\d{2}$/,
  dias_vencimiento_pedido: /^\d{1,3}$/,
  monto_minimo_nit: /^\d{1,8}(\.\d{1,2})?$/,
};

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
    if (!dto.valor && !OPCIONALES.has(clave))
      throw new BadRequestException('Este parámetro no puede quedar vacío');
    if (NUMERICOS[clave] && !NUMERICOS[clave].test(dto.valor))
      throw new BadRequestException('Valor inválido para este parámetro');
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
