import { Global, Module } from '@nestjs/common';
import { ManualPasarelaProvider, PASARELA_PAGO } from './pagos/pasarela-pago.provider';
import { FACTURACION, ManualFacturacionProvider } from './fel/facturacion.provider';

/**
 * Selecciona el proveedor según variables de entorno.
 * Fase 2: agregar aquí el proveedor real (ej. case 'recurrente', case 'infile') sin tocar el resto del sistema.
 */
@Global()
@Module({
  providers: [
    {
      provide: PASARELA_PAGO,
      useFactory: () => {
        switch (process.env.PAGOS_PROVEEDOR) {
          default:
            return new ManualPasarelaProvider();
        }
      },
    },
    {
      provide: FACTURACION,
      useFactory: () => {
        switch (process.env.FEL_PROVEEDOR) {
          default:
            return new ManualFacturacionProvider();
        }
      },
    },
  ],
  exports: [PASARELA_PAGO, FACTURACION],
})
export class IntegracionesModule {}
