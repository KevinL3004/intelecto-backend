import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Grado } from '../../database/entities';
import { GradosController } from './grados.controller';

@Module({ imports: [TypeOrmModule.forFeature([Grado])], controllers: [GradosController] })
export class GradosModule {}
