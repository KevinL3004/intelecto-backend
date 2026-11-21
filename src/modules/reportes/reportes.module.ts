import { Module } from '@nestjs/common';
import { AvisosController } from './avisos.controller';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';

@Module({ controllers: [ReportesController, AvisosController], providers: [ReportesService] })
export class ReportesModule {}
