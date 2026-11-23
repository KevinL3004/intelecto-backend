import type { Request, Response } from 'express';
import { aId, entradaSegura } from './entrada-segura';

describe('aId (ids en la ruta)', () => {
  it.each(['1', '42', '9007199254740991'])('acepta %s', (v) => expect(aId(v)).toBe(Number(v)));
  it.each([
    '0',
    '-1',
    '+2',
    '1.5',
    '1e3',
    '0x10',
    ' 1',
    '01',
    'abc',
    '',
    '9007199254740992',
    '99999999999999999999',
    '1 OR 1=1',
  ])('rechaza %p', (v) => expect(aId(v)).toBeNull());
});

describe('entradaSegura', () => {
  const correr = (req: Partial<Request>) => {
    let status = 0;
    let body: { message?: string } = {};
    const res = {
      status: (s: number) => ((status = s), res),
      json: (b: object) => ((body = b), res),
    } as unknown as Response;
    const next = jest.fn();
    const r = {
      path: '/x',
      query: {},
      headers: {},
      is: (t: string) => (req.headers?.['content-type'] === t ? t : false),
      ...req,
    } as unknown as Request;
    entradaSegura(r, res, next);
    return { status, body, paso: next.mock.calls.length === 1 };
  };
  const json = (body: unknown) => ({
    body,
    headers: { 'content-type': 'application/json', 'content-length': '10' },
  });

  it('deja pasar datos normales (con tildes, saltos de línea y comillas)', () => {
    expect(correr(json({ nombres: "José O'Brien", obs: 'línea 1\nlínea 2', n: 5 })).paso).toBe(
      true,
    );
  });
  it.each([
    ['byte nulo', { a: 'x\u0000y' }],
    ['carácter de control', { a: 'x\u001by' }],
    ['número enorme', { id: 1e20 }],
    ['anidamiento extremo', JSON.parse('{"a":' + '['.repeat(50) + ']'.repeat(50) + '}')],
    ['__proto__', JSON.parse('{"__proto__":{"rol":"ADMIN"}}')],
    ['constructor', { constructor: { prototype: {} } }],
  ])('rechaza %s en el cuerpo', (_n, body) => {
    const r = correr(json(body));
    expect(r.paso).toBe(false);
    expect(r.status).toBe(400);
  });
  it('rechaza bytes nulos en la ruta y en los parámetros', () => {
    expect(correr({ path: '/config/parametros/a%00b' }).status).toBe(400);
    expect(correr({ query: { q: 'a\u0000' } }).status).toBe(400);
  });
  it('rechaza cuerpos que no son JSON', () => {
    expect(
      correr({ headers: { 'content-type': 'text/plain', 'content-length': '3' } }).status,
    ).toBe(415);
  });
});
