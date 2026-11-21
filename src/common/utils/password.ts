import { ValidateBy, ValidationOptions } from 'class-validator';

/** Costo de bcrypt (2^12 rondas). Los hashes con costo menor se actualizan al iniciar sesión. */
export const BCRYPT_COSTO = 12;
export const PASSWORD_MIN = 12;
/** bcrypt ignora todo lo que pase de 72 bytes: se rechaza para que no haya colisiones silenciosas. */
export const PASSWORD_MAX_BYTES = 72;

/** Contraseñas y fragmentos demasiado comunes (complementa la longitud mínima). */
const COMUNES = [
  'password',
  'contrasena',
  'contraseña',
  'qwerty',
  'asdfgh',
  'zxcvbn',
  '123456',
  '654321',
  'abc123',
  'iloveyou',
  'admin',
  'administrador',
  'bienvenido',
  'welcome',
  'guatemala',
  'intelecto',
  'cambiar',
  'temporal',
  'prueba',
  'letmein',
  'monkey',
  'dragon',
  'football',
  'futbol',
];

/** Devuelve la lista de problemas (vacía si la contraseña es aceptable). */
export function problemasPassword(p: string, usuario?: string | null): string[] {
  const r: string[] = [];
  if (typeof p !== 'string') return ['La contraseña es obligatoria'];
  if (p.length < PASSWORD_MIN) r.push(`al menos ${PASSWORD_MIN} caracteres`);
  if (Buffer.byteLength(p, 'utf8') > PASSWORD_MAX_BYTES)
    r.push(`máximo ${PASSWORD_MAX_BYTES} bytes`);
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p))
    r.push('mayúscula, minúscula y número');
  const baja = p.toLowerCase();
  if (COMUNES.some((c) => baja.includes(c)))
    r.push('no usar palabras comunes ni el nombre del sistema');
  if (usuario && usuario.length >= 3 && baja.includes(usuario.toLowerCase()))
    r.push('no incluir el nombre de usuario');
  if (/(.)\1{3,}/.test(p)) r.push('no repetir el mismo carácter 4 veces seguidas');
  return r;
}

export const mensajePassword = (problemas: string[]) =>
  `Contraseña insegura: ${problemas.join('; ')}`;

/** Decorador de DTO con la política (sin la regla del usuario, que se valida en el servicio). */
export function PasswordSegura(opciones?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'passwordSegura',
      validator: {
        validate: (v: unknown) => typeof v === 'string' && problemasPassword(v).length === 0,
        defaultMessage: (a) => mensajePassword(problemasPassword(String(a?.value ?? ''))),
      },
    },
    opciones,
  );
}
