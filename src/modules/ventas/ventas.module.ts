import { Module } from '@nestjs/common';
import { TurnosModule } from '../turnos/turnos.module';
import { CorreoModule } from '../correo/correo.module';
import { AlumnosModule } from '../alumnos/alumnos.module';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  imports: [TurnosModule, CorreoModule, AlumnosModule],
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
