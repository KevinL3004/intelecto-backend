import {
  applyDecorators,
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { aId, ID_MAX } from './entrada-segura';

export { entradaSegura, ID_MAX } from './entrada-segura';

/** Id de un registro: entero positivo y representable sin pérdida. */
export const EsId = () =>
  applyDecorators(
    IsInt({ message: ({ property }) => `${property} debe ser un id válido` }),
    Min(1, { message: ({ property }) => `${property} debe ser un id válido` }),
    Max(ID_MAX, { message: ({ property }) => `${property} debe ser un id válido` }),
  );

/**
 * Campo opcional que NO admite null: si viene, se valida (null incluido, y se rechaza).
 * `IsOptional` deja pasar null, que en columnas NOT NULL terminaba en error 500.
 */
export const Opcional = () => ValidateIf((_o: object, v: unknown) => v !== undefined);

/**
 * Id en la ruta (/ventas/:id): solo dígitos, sin signo, espacios, decimales ni exponentes.
 * Lee el texto CRUDO de la ruta: un pipe recibiría el valor ya convertido por el ValidationPipe
 * global (que transforma "+2" o "0x10" en números), y la validación no serviría.
 */
export const ParamId = createParamDecorator((nombre: string, ctx: ExecutionContext) => {
  const n = aId(String(ctx.switchToHttp().getRequest<Request>().params[nombre] ?? ''));
  if (n === null) throw new BadRequestException('Identificador inválido');
  return n;
});
