import { bool } from './env.validation';

/** Banderas de funcionalidad de fase 2. Se leen de variables de entorno. */
export type FeatureName = 'PORTAL_CLIENTES' | 'PAGOS_LINEA' | 'FEL';

export function isFeatureEnabled(name: FeatureName): boolean {
  return bool(process.env[`FEATURE_${name}`]);
}

export function featuresSnapshot(): Record<FeatureName, boolean> {
  return {
    PORTAL_CLIENTES: isFeatureEnabled('PORTAL_CLIENTES'),
    PAGOS_LINEA: isFeatureEnabled('PAGOS_LINEA'),
    FEL: isFeatureEnabled('FEL'),
  };
}
