import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvVars {
  @IsIn(['development', 'production', 'test']) NODE_ENV = 'development';
  @Type(() => Number) @IsInt() @IsOptional() PORT: number = 3000;
  @IsString() @IsNotEmpty() DATABASE_URL: string;
  /** Secreto HS256 del token de acceso: mínimo 32 caracteres (`openssl rand -hex 32`). */
  @IsString() @MinLength(32) JWT_SECRET: string;
  @IsString() @IsNotEmpty() CORS_ORIGIN: string;
}

/** Valores de ejemplo que nunca deben llegar a producción. */
const INSEGUROS = ['cambiar', 'changeme', 'secret', 'intelecto_dev', 'admin'];

export function validateEnv(config: Record<string, unknown>) {
  const env = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errores = validateSync(env, { skipMissingProperties: false }).map((e) => e.property);

  const origenes = String(env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim());
  if (origenes.some((o) => o === '*' || o === ''))
    errores.push('CORS_ORIGIN (no se permite "*" ni orígenes vacíos)');

  if (env.NODE_ENV === 'production') {
    for (const clave of ['JWT_SECRET', 'DATABASE_URL'] as const) {
      const v = String(env[clave] ?? '').toLowerCase();
      if (INSEGUROS.some((x) => v.includes(x))) errores.push(`${clave} (valor de ejemplo)`);
    }
    if (!bool(String(config.DATABASE_SSL ?? '')))
      errores.push('DATABASE_SSL (debe ser true en producción)');
    if (origenes.some((o) => !o.startsWith('https://')))
      errores.push('CORS_ORIGIN (en producción solo https://)');
  }

  if (errores.length)
    // Solo nombres de variables: nunca se imprimen los valores (podrían ser secretos).
    throw new Error(`Variables de entorno inválidas: ${errores.join(', ')}`);
  return config;
}

export const bool = (v?: string) => String(v).toLowerCase() === 'true';
