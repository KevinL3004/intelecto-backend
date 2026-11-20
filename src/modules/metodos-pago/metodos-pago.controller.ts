import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { ClientIp, CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { MetodoPago } from '../../database/entities';
import { BitacoraService } from '../bitacora/bitacora.service';

class RecargoDto {
  @ApiProperty({ example: 5, description: 'Porcentaje de recargo (0 a 15)' })
  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(15)
  recargoPct: number;
}

@ApiTags('metodos-pago')
@ApiBearerAuth()
@Controller('metodos-pago')
export class MetodosPagoController {
  constructor(
    @InjectRepository(MetodoPago) private readonly repo: Repository<MetodoPago>,
    private readonly bitacora: BitacoraService,
  ) {}

  /** El POS lo consulta al cobrar: siempre trae el recargo vigente (RN-01). */
  @Get()
  listar() {
    return this.repo.find({ where: { activo: true }, order: { id: 'ASC' } });
  }

  /** RN-01: solo el Administrador cambia el recargo; aplica de inmediato a ventas nuevas. */
  @Roles(Rol.ADMIN)
  @Patch(':id/recargo')
  async recargo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecargoDto,
    @CurrentUser() u: UsuarioActual,
    @ClientIp() ip: string,
  ) {
    const antes = await this.repo.findOneBy({ id });
    if (!antes) throw new NotFoundException('Método de pago no encontrado');
    await this.repo.update(id, { recargoPct: dto.recargoPct.toFixed(2), actualizadoPor: u.id });
    const despues = await this.repo.findOneByOrFail({ id });
    await this.bitacora.registrar({
      usuarioId: u.id,
      accion: 'CONFIG_RECARGO',
      entidad: 'metodo_pago',
      entidadId: id,
      antes: { recargoPct: antes.recargoPct },
      despues: { recargoPct: despues.recargoPct },
      ip,
    });
    return despues;
  }
}
