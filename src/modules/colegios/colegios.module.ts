import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Colegio } from '../../database/entities';
import { ColegiosController } from './colegios.controller';
import { ColegiosService } from './colegios.service';

@Module({
  imports: [TypeOrmModule.forFeature([Colegio])],
  controllers: [ColegiosController],
  providers: [ColegiosService],
  exports: [ColegiosService],
})
export class ColegiosModule {}
