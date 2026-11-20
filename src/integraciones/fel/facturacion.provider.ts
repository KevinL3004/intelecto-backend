/**
 * FASE 2 — Contrato para facturación electrónica FEL (SAT Guatemala) mediante un certificador.
 * Hoy se usa ManualFacturacionProvider (no certifica).
 */
export interface FacturaInput {
  ventaId: number;
  nitReceptor: string;
  nombreReceptor: string;
  items: { descripcion: string; cantidad: number; precioUnitario: string; total: string }[];
  total: string;
}

export interface FacturaCertificada {
  serie: string;
  numero: string;
  uuidAutorizacion: string;
  xml: string;
  certificador: string;
}

export interface FacturacionProvider {
  readonly nombre: string;
  certificar(input: FacturaInput): Promise<FacturaCertificada>;
  anular(uuidAutorizacion: string, motivo: string): Promise<void>;
}

export const FACTURACION = Symbol('FACTURACION');

export class ManualFacturacionProvider implements FacturacionProvider {
  readonly nombre = 'manual';
  async certificar(): Promise<never> {
    throw new Error('FEL no habilitado (FEATURE_FEL=false)');
  }
  async anular(): Promise<never> {
    throw new Error('FEL no habilitado (FEATURE_FEL=false)');
  }
}
