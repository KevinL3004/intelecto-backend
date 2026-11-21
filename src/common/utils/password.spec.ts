import { problemasPassword } from './password';

describe('política de contraseñas', () => {
  it('acepta una contraseña robusta', () =>
    expect(problemasPassword('Libros-Escolares-87')).toEqual([]));
  it('exige 12 caracteres', () =>
    expect(problemasPassword('Corta9Ab')).toContain('al menos 12 caracteres'));
  it('exige mayúscula, minúscula y número', () =>
    expect(problemasPassword('todominusculas-larga')).toContain('mayúscula, minúscula y número'));
  it('rechaza palabras comunes (sin importar mayúsculas)', () =>
    expect(problemasPassword('MiPassword2026x').join()).toMatch(/comunes/));
  it('rechaza el nombre del sistema', () =>
    expect(problemasPassword('Intelecto2026!x').join()).toMatch(/comunes/));
  it('rechaza contener el usuario', () =>
    expect(problemasPassword('Xcajero.norte99Z', 'cajero.norte')).toContain(
      'no incluir el nombre de usuario',
    ));
  it('rechaza más de 72 bytes (límite de bcrypt)', () =>
    expect(problemasPassword('Aa1' + 'ñ'.repeat(40))).toContain('máximo 72 bytes'));
  it('rechaza repeticiones', () =>
    expect(problemasPassword('Aaaaa-Bosque-27')).toContain(
      'no repetir el mismo carácter 4 veces seguidas',
    ));
});
