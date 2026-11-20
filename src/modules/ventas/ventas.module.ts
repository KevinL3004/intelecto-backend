import { Module } from '@nestjs/common';
import { TurnosModule } from '../turnos/turnos.module';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({ imports: [TurnosModule], controllers: [VentasController], providers: [VentasService] })
export class VentasModule {}
