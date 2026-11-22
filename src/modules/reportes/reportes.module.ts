import { Module } from '@nestjs/common';
import { AvisosController } from './avisos.controller';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { AnalisisService } from './analisis.service';

@Module({
  controllers: [ReportesController, AvisosController],
  providers: [ReportesService, AnalisisService],
})
export class ReportesModule {}
