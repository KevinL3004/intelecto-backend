import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Parametro } from '../../database/entities';
import { ConfigController } from './config.controller';

@Module({ imports: [TypeOrmModule.forFeature([Parametro])], controllers: [ConfigController] })
export class AppConfigModule {}
