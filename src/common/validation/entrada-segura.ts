import type { NextFunction, Request, Response } from 'express';

/** Mayor id aceptado (2^53 − 1): más allá JavaScript pierde exactitud o desborda BIGINT. */
export const ID_MAX = Number.MAX_SAFE_INTEGER;

/** Id de la ruta: solo dígitos, sin signo, ceros a la izquierda, decimales ni exponentes. */
export const aId = (v: string): number | null => {
  const n = /^[1-9]\d{0,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};

/** Anidamiento máximo de un cuerpo JSON (la venta más compleja usa 4 niveles). */
const PROFUNDIDAD_MAX = 8;
/**
 * Caracteres de control (salvo tabulador y saltos de línea). El byte nulo, en particular, PostgreSQL
 * no lo admite en texto y otros sirven para falsear registros o la bitácora.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function revisar(v: unknown, donde: string, prof = 0): string | null {
  if (typeof v === 'string')
    return CONTROL.test(v) ? `${donde}: contiene caracteres no permitidos` : null;
  if (typeof v === 'number')
    return Number.isFinite(v) && Math.abs(v) <= ID_MAX ? null : `${donde}: número fuera de rango`;
  if (v === null || typeof v !== 'object') return null;
  if (prof >= PROFUNDIDAD_MAX) return 'La petición tiene demasiados niveles anidados';
  for (const [k, x] of Object.entries(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype')
      return 'La petición contiene campos no permitidos';
    const e = revisar(x, donde, prof + 1);
    if (e) return e;
  }
  return null;
}

/**
 * Primera barrera para TODA petición, antes de cualquier validador: rechaza bytes de control,
 * números no representables, anidamientos extremos (agotan la pila al validar) y claves que
 * contaminan prototipos. Lo que pase de aquí lo validan los DTO campo por campo.
 */
export function entradaSegura(req: Request, res: Response, next: NextFunction) {
  let ruta = req.path;
  try {
    ruta = decodeURIComponent(req.path);
  } catch {
    return rechazar(res, req, 'La dirección contiene caracteres inválidos');
  }
  const conCuerpo =
    Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding'];
  if (conCuerpo && !req.is('application/json'))
    return rechazar(res, req, 'El contenido debe enviarse como JSON', 415);
  const error =
    (CONTROL.test(ruta) ? 'La dirección contiene caracteres no permitidos' : null) ??
    revisar(req.query, 'Parámetro') ??
    revisar(req.body, 'Dato');
  if (error) return rechazar(res, req, error);
  next();
}

function rechazar(res: Response, req: Request, message: string, status = 400) {
  res.status(status).json({
    statusCode: status,
    error: status === 415 ? 'TIPO_NO_SOPORTADO' : 'VALIDACION',
    message,
    timestamp: new Date().toISOString(),
    path: req.path,
  });
}
