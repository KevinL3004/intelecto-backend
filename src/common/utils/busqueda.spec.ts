import { coincide, patron } from './busqueda';

describe('busqueda', () => {
  it('envuelve con % y recorta espacios', () => expect(patron('  maria ')).toBe('%maria%'));
  it('escapa comodines del usuario', () => expect(patron('50%_x')).toBe('%50\\%\\_x%'));
  it('arma la expresión normalizada', () =>
    expect(coincide('l.titulo')).toBe("f_norm(coalesce(l.titulo, '')) LIKE f_norm(:q)"));
});
