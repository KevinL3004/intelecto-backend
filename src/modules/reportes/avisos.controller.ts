import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';

/**
 * Contadores de trabajo pendiente para los avisos del menú. Solo números (nada de datos
 * personales ni montos) y cada rol recibe únicamente los suyos.
 */
@ApiTags('reportes')
@ApiBearerAuth()
@Controller('avisos')
export class AvisosController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async avisos(@CurrentUser() u: UsuarioActual) {
    const cajero = u.rol === Rol.CAJERO;
    // Ventas pagadas con libros por entregar (el cajero: las de su colegio, como en CU-10).
    const [{ n: entregasPendientes }] = await this.ds.query(
      `SELECT count(*)::int AS n FROM venta
        WHERE estado_pago = 'PAGADA' AND estado_entrega <> 'COMPLETA'
          AND ($1::bigint IS NULL OR colegio_id = $1)`,
      [cajero ? (u.colegioId ?? -1) : null],
    );
    if (cajero) return { entregasPendientes };

    const [r] = await this.ds.query(
      `SELECT
         (SELECT count(*) FROM turno_caja WHERE estado = 'CERRADO')::int AS "turnosPorValidar",
         (SELECT count(*) FROM traslado WHERE estado = 'EN_TRANSITO')::int AS "trasladosPorRecibir",
         (SELECT count(*) FROM traslado WHERE estado = 'BORRADOR')::int AS "trasladosPorDespachar",
         (SELECT coalesce(sum(d.cantidad), 0) FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
           WHERE v.estado_pago = 'PAGADA' AND d.estado = 'PENDIENTE_TRASLADO')::int AS "unidadesPorTrasladar",
         (SELECT coalesce(sum(d.cantidad), 0) FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
           WHERE v.estado_pago = 'PAGADA' AND d.estado = 'PENDIENTE_PROVEEDOR')::int AS "unidadesPorPedir",
         (SELECT count(*) FROM correo_saliente
           WHERE estado = 'FALLIDO' AND creado_en > now() - interval '7 days')::int AS "correosFallidos"`,
    );
    return { entregasPendientes, ...r };
  }
}
