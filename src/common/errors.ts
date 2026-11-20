import { HttpException, HttpStatus } from '@nestjs/common';

/** Error de negocio con código propio para que el frontend muestre mensajes claros. */
export class BusinessError extends HttpException {
  constructor(code: string, message: string, status: number = HttpStatus.CONFLICT) {
    super({ error: code, message }, status as HttpStatus);
  }
}
