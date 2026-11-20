import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

class EnvVars {
  @IsIn(['development', 'production', 'test']) NODE_ENV = 'development';
  @Type(() => Number) @IsInt() @IsOptional() PORT: number = 3000;
  @IsString() @IsNotEmpty() DATABASE_URL: string;
  @IsString() @IsNotEmpty() JWT_SECRET: string;
  @IsString() @IsNotEmpty() JWT_REFRESH_SECRET: string;
  @IsString() @IsNotEmpty() CORS_ORIGIN: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const env = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(`Variables de entorno inválidas: ${errors.map((e) => e.property).join(', ')}`);
  }
  return config;
}

export const bool = (v?: string) => String(v).toLowerCase() === 'true';
