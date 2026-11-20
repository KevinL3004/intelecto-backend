import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetodoPago } from '../../database/entities';
import { MetodosPagoController } from './metodos-pago.controller';

@Module({ imports: [TypeOrmModule.forFeature([MetodoPago])], controllers: [MetodosPagoController] })
export class MetodosPagoModule {}
