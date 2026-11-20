import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Persona, Usuario } from '../../database/entities';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, Persona])],
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
