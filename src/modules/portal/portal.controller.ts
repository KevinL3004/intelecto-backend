import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feature, Public } from '../../common/decorators';
import { Colegio } from '../../database/entities';

/**
 * FASE 2 — Portal de clientes.
 * Todas las rutas quedan apagadas (404) mientras FEATURE_PORTAL_CLIENTES=false.
 * Pendiente de activar: GET /public/combos, POST /public/pedidos, GET /public/pedidos/:codigo.
 */
@ApiTags('portal (fase 2)')
@Public()
@Feature('PORTAL_CLIENTES')
@Controller('public')
export class PortalController {
  constructor(@InjectRepository(Colegio) private readonly colegios: Repository<Colegio>) {}

  @Get('colegios')
  listarColegios() {
    return this.colegios.find({
      where: { activo: true },
      select: { id: true, nombre: true },
      order: { nombre: 'ASC' },
    });
  }
}
