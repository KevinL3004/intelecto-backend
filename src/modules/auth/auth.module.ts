import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SesionesService } from './sesiones.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [AuthController],
  providers: [AuthService, SesionesService],
  exports: [SesionesService],
})
export class AuthModule {}
