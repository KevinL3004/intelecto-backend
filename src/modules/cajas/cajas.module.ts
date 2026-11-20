import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Caja } from '../../database/entities';
import { CajasController } from './cajas.controller';

@Module({ imports: [TypeOrmModule.forFeature([Caja])], controllers: [CajasController] })
export class CajasModule {}
