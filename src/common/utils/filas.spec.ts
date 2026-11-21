import { filas } from './filas';

describe('filas', () => {
  it('UPDATE/DELETE … RETURNING: [filas, cantidad] → filas', () => {
    expect(filas([[{ id: 1 }, { id: 2 }], 2])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(filas([[], 0])).toEqual([]);
  });
  it('SELECT / INSERT: ya son filas', () => {
    expect(filas([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(filas([])).toEqual([]);
  });
});
