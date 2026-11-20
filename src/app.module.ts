import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { FeatureGuard } from './common/guards/feature.guard';
import { IntegracionesModule } from './integraciones/integraciones.module';
import { BitacoraModule } from './modules/bitacora/bitacora.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PersonasModule } from './modules/personas/personas.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { ColegiosModule } from './modules/colegios/colegios.module';
import { GradosModule } from './modules/grados/grados.module';
import { CajasModule } from './modules/cajas/cajas.module';
import { MetodosPagoModule } from './modules/metodos-pago/metodos-pago.module';
import { LibrosModule } from './modules/libros/libros.module';
import { PreciosModule } from './modules/precios/precios.module';
import { CombosModule } from './modules/combos/combos.module';
import { InventarioModule } from './modules/inventario/inventario.module';
import { TurnosModule } from './modules/turnos/turnos.module';
import { VentasModule } from './modules/ventas/ventas.module';
import { TrasladosModule } from './modules/traslados/traslados.module';
import { ProveedoresModule } from './modules/proveedores/proveedores.module';
import { AppConfigModule } from './modules/config/config.module';
import { PortalModule } from './modules/portal/portal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({ global: true }),
    DatabaseModule,
    IntegracionesModule,
    BitacoraModule,
    HealthModule,
    AuthModule,
    PersonasModule,
    UsuariosModule,
    ColegiosModule,
    GradosModule,
    CajasModule,
    MetodosPagoModule,
    LibrosModule,
    PreciosModule,
    CombosModule,
    InventarioModule,
    TurnosModule,
    VentasModule,
    TrasladosModule,
    ProveedoresModule,
    AppConfigModule,
    PortalModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule {}
