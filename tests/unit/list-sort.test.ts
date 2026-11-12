import { describe, expect, it } from 'vitest';
import { sortList } from '../../src/lib/list-sort';

type R = { name: string; nr: string; at: number | null };
const rows: R[] = [
  { name: 'Bahnhof', nr: '91090', at: 3 },
  { name: 'ansicht', nr: '', at: 1 },
  { name: 'Halle 10', nr: '9', at: null },
  { name: 'Halle 2', nr: '10', at: 2 },
];
const get = { name: (r: R) => r.name, nr: (r: R) => r.nr, at: (r: R) => r.at };

describe('Sortierung (Art + Richtung)', () => {
  it('Text natürlich und ohne Groß-/Kleinschreibung, auf- und absteigend', () => {
    expect(sortList(rows, { key: 'name', dir: 'asc' }, get).map((r) => r.name)).toEqual(['ansicht', 'Bahnhof', 'Halle 2', 'Halle 10']);
    expect(sortList(rows, { key: 'name', dir: 'desc' }, get).map((r) => r.name)).toEqual(['Halle 10', 'Halle 2', 'Bahnhof', 'ansicht']);
  });
  it('Nummern natürlich; leere Werte immer am Ende', () => {
    expect(sortList(rows, { key: 'nr', dir: 'asc' }, get).map((r) => r.nr)).toEqual(['9', '10', '91090', '']);
    expect(sortList(rows, { key: 'nr', dir: 'desc' }, get).map((r) => r.nr)).toEqual(['91090', '10', '9', '']);
    expect(sortList(rows, { key: 'at', dir: 'desc' }, get).map((r) => r.at)).toEqual([3, 2, 1, null]);
  });
});
