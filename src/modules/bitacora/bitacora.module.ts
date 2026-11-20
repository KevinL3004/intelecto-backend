import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bitacora } from '../../database/entities';
import { BitacoraService } from './bitacora.service';
import { BitacoraController } from './bitacora.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Bitacora])],
  providers: [BitacoraService],
  controllers: [BitacoraController],
  exports: [BitacoraService],
})
export class BitacoraModule {}
