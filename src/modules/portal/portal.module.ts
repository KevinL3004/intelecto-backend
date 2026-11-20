import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Colegio } from '../../database/entities';
import { PortalController } from './portal.controller';

@Module({ imports: [TypeOrmModule.forFeature([Colegio])], controllers: [PortalController] })
export class PortalModule {}
