/**
 * FASE 2 — Contrato para pagos en línea (pasarela o links de pago).
 * Hoy se usa ManualPasarelaProvider: el pago con tarjeta se cobra fuera del sistema
 * y solo se registra la referencia.
 */
export interface CrearCobroInput {
  ventaId: number;
  codigo: string;
  monto: string; // decimal en string, nunca float
  descripcion: string;
  correoCliente?: string | null;
}

export interface CobroCreado {
  proveedor: string;
  transaccionId: string | null;
  urlPago: string | null; // link de pago a enviar al cliente
}

export interface PasarelaPagoProvider {
  readonly nombre: string;
  crearCobro(input: CrearCobroInput): Promise<CobroCreado>;
  /** Valida la notificación (webhook) del proveedor y devuelve el estado. */
  procesarWebhook(
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ transaccionId: string; estado: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' }>;
}

export const PASARELA_PAGO = Symbol('PASARELA_PAGO');

export class ManualPasarelaProvider implements PasarelaPagoProvider {
  readonly nombre = 'manual';
  async crearCobro(): Promise<CobroCreado> {
    return { proveedor: this.nombre, transaccionId: null, urlPago: null };
  }
  async procesarWebhook(): Promise<never> {
    throw new Error('Pagos en línea no habilitados (FEATURE_PAGOS_LINEA=false)');
  }
}
