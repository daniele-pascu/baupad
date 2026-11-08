import { describe, expect, it } from 'vitest';
import { rebarItemsOf, rebarLine, rebarTotal } from '../../src/lib/rebar';

describe('Bewehrung', () => {
  it('Stück × Länge, Summe in lfm (auf 2 Stellen)', () => {
    expect(rebarLine({ count: 4, length: 1.2 })).toBe(4.8);
    expect(rebarTotal([{ count: 4, length: 1.2 }, { count: 2, length: 0.8 }, { count: 3, length: 0.333 }])).toBe(7.4);
    expect(rebarTotal([])).toBe(0);
  });
  it('ältere Messung nur mit Summe → eine Zeile 1 × Summe', () => {
    expect(rebarItemsOf({ rebar: 3.5 })).toEqual([{ count: 1, length: 3.5 }]);
    expect(rebarItemsOf({ rebar: null })).toEqual([]);
    const items = [{ id: 'a', count: 2, length: 1 }];
    expect(rebarItemsOf({ rebar: 2, rebarItems: items })).toBe(items);
  });
});
