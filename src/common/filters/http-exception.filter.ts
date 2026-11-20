import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

type HttpBody = string | { error?: string; message?: string | string[] };

/** Formato estándar de error: { statusCode, error, message, timestamp, path } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'ERROR_INTERNO';
    let message: string | string[] = 'Ocurrió un error inesperado';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as HttpBody;
      error = HttpStatus[status] ?? error;
      if (typeof body === 'string') message = body;
      else {
        message = body.message ?? exception.message;
        if (body.error && body.error.toUpperCase() === body.error) error = body.error;
      }
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(message)) error = 'VALIDACION';
    } else if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code;
      if (code === '23505') {
        status = HttpStatus.CONFLICT;
        error = 'DUPLICADO';
        message = 'Ya existe un registro con esos datos';
      } else if (code === '23503') {
        status = HttpStatus.CONFLICT;
        error = 'EN_USO';
        message = 'El registro está relacionado con otros datos';
      } else if (code === '23514') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        error = 'REGLA_BD';
        message = 'Los datos no cumplen una regla del sistema';
      } else {
        this.logger.error(exception.message);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    // Si la respuesta ya salió (p. ej. un archivo), no se puede responder otra vez:
    // intentarlo lanzaría un error fuera de Nest que tumbaría el proceso.
    if (res.headersSent) {
      this.logger.error(`Error después de enviar la respuesta: ${String(message)}`);
      return;
    }
    res.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
