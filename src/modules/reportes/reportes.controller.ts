import {
  ForbiddenException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles, UsuarioActual } from '../../common/decorators';
import { Rol } from '../../common/roles';
import { FiltroColegioDto } from '../traslados/dto/traslado.dto';
import { ReportesService } from './reportes.service';
import { FiltroReporteDto, TIPOS, TipoReporte } from './reportes.dto';
import { reporteAExcel } from './excel';

/** Reportes que también puede ver el cajero (sus ventas y los pendientes de su colegio). */
const PARA_CAJERO: TipoReporte[] = ['ventas', 'pendientes'];

@ApiTags('reportes')
@ApiBearerAuth()
@Controller('reportes')
export class ReportesController {
  constructor(private readonly service: ReportesService) {}

  /** R-13: tablero del día. */
  @Roles(Rol.ADMIN, Rol.CONTADOR)
  @Get('dashboard')
  dashboard(@Query() f: FiltroColegioDto) {
    return this.service.dashboard(f.colegioId);
  }

  /** GET /reportes/:tipo — mismo endpoint con ?formato=xlsx para exportar a Excel. */
  @Get(':tipo')
  async reporte(
    @Param('tipo') tipo: string,
    @Query() f: FiltroReporteDto,
    @CurrentUser() u: UsuarioActual,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(TIPOS as readonly string[]).includes(tipo))
      throw new NotFoundException('Reporte no encontrado');
    const t = tipo as TipoReporte;
    if (u.rol === Rol.CAJERO && !PARA_CAJERO.includes(t))
      throw new ForbiddenException('No tiene acceso a este reporte');

    const excel = f.formato === 'xlsx';
    const r = await this.service.generar(t, f, u, excel);
    if (!excel) return r;

    const rango = [f.desde && `desde ${f.desde}`, f.hasta && `hasta ${f.hasta}`]
      .filter(Boolean)
      .join(' ');
    const buf = await reporteAExcel(
      r,
      `Generado ${new Date().toISOString().slice(0, 10)} ${rango}`.trim(),
    );
    const nombre = `reporte-${t}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    });
    // StreamableFile: Nest envía el archivo una sola vez (res.send + return enviaba dos respuestas
    // y el segundo intento tumbaba el proceso).
    return new StreamableFile(buf);
  }
}
