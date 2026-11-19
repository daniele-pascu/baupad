import { describe, expect, it } from 'vitest';
import { quantityLines } from '../../src/lib/measure-types';
import type { Damage } from '../../src/lib/types';

const d = (x: Partial<Damage>): Damage => ({ kind: 'line', shape: { type: 'line', x: 0, y: 0, w: 1, h: 0 }, length: 0, width: null, depth: null, area: null, count: 1, deductions: [], ...x }) as unknown as Damage;

describe('Übersicht: Mengen je Einheit statt immer m²', () => {
  it('nur Längen → nur Meter', () => {
    expect(quantityLines([d({ measureType: 'laenge', length: 5.1 }), d({ measureType: 'laenge', length: 1.2 })])).toEqual(['6,30 m']);
  });
  it('gemischt: Fläche, Länge, Stück in fester Reihenfolge', () => {
    const list = [
      d({ measureType: 'stueck', kind: 'line', count: 7 }),
      d({ measureType: 'laenge', length: 2 }),
      d({ measureType: 'flaeche', kind: 'area', length: 2, width: 3, area: 6 }),
    ];
    expect(quantityLines(list)).toEqual(['6,00 m²', '2,00 m', '7 Stk']);
  });
  it('keine Messungen → leer', () => {
    expect(quantityLines([])).toEqual([]);
  });
});
