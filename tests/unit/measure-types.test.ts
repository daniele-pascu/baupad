import { describe, expect, it } from 'vitest';
import { calcPath, countOf, defaultTypeFor, evalFormula, lineTotal, normUnit, quantityOfMeasure, totalsByUnit, typeOf } from '../../src/lib/measure-types';
import type { Damage, Shape } from '../../src/lib/types';

const rect: Shape = { type: 'rect', x: 0, y: 0, w: 10, h: 5 };
const line: Shape = { type: 'line', x: 0, y: 0, w: 10, h: 0, points: [[0, 0], [1, 0]] };
type M = Parameters<typeof calcPath>[0] & Parameters<typeof quantityOfMeasure>[0];
const m = (p: Partial<Damage>): M => ({ kind: 'area', shape: rect, length: 0, width: null, depth: null, area: null, deductions: undefined, areaFromShape: undefined, ...p }) as M;

describe('Messarten: Übernahme älterer Messungen (nur zuordnen, nichts umrechnen)', () => {
  it('kind → Messart', () => {
    expect(typeOf({ kind: undefined, shape: rect })).toBe('schadstelle');
    expect(typeOf({ kind: 'damage', shape: rect })).toBe('schadstelle');
    expect(typeOf({ kind: 'area', shape: rect })).toBe('flaeche');
    expect(typeOf({ kind: 'area', shape: line })).toBe('wand'); // Wand-Werkzeug: Fläche mit offenem Verlauf
    expect(typeOf({ kind: 'line', shape: line })).toBe('laenge');
    expect(typeOf({ kind: 'line', shape: line, measureType: 'stueck' })).toBe('stueck');
    expect(defaultTypeFor(rect)).toBe('flaeche');
    expect(defaultTypeFor(line)).toBe('laenge');
    expect(defaultTypeFor(line, true)).toBe('wand');
    expect(countOf({})).toBe(1);
    expect(countOf({ count: 3 })).toBe(3);
  });
});

describe('Rechnung', () => {
  it('freie Formel: Komma, ×, Klammern, Fehler', () => {
    expect(evalFormula('2*3,5+1,2')).toBe(8.2);
    expect(evalFormula('(4,5 + 2) × 2,75')).toBe(17.875);
    expect(evalFormula('10/4')).toBe(2.5);
    expect(evalFormula('-2+5')).toBe(3);
    expect(evalFormula('2*')).toBeNull();
    expect(evalFormula('1/0')).toBeNull();
    expect(evalFormula('alert(1)')).toBeNull();
    expect(evalFormula('')).toBeNull();
  });
  it('Länge mit Anzahl und Abzug', () => {
    expect(lineTotal({ count: 2, length: 4.5, deductions: [{ id: 'a', label: 'Tür', count: 1, length: 0.9 }] })).toBe(8.1);
  });
  it('Menge je Messart und Summen getrennt nach Einheit', () => {
    const list = [
      m({ measureType: 'flaeche', length: 4.5, width: 2.75, count: 2, area: 24.75 }),
      m({ measureType: 'laenge', kind: 'line', shape: line, length: 3, count: 2 }),
      m({ measureType: 'volumen', length: 2, width: 1, depth: 0.5, area: 2 }),
      m({ measureType: 'stueck', kind: 'line', count: 4 }),
      m({ measureType: 'frei', kind: 'line', qty: 8.2, unit: 'kg' }),
      m({ measureType: 'frei', kind: 'line', qty: 1.5, unit: 'm2' }),
    ];
    expect(quantityOfMeasure(list[2])).toEqual({ value: 1, unit: 'm³' });
    expect(totalsByUnit(list)).toEqual([
      { unit: 'm²', value: 26.25 },
      { unit: 'm', value: 6 },
      { unit: 'm³', value: 1 },
      { unit: 'Stk', value: 4 },
      { unit: 'kg', value: 8.2 },
    ]);
    expect(normUnit('Stück')).toBe('Stk');
  });
});

describe('Rechenweg', () => {
  it('Fläche, Wand mit Öffnung und Stärke, Länge, Volumen, Stück, Frei', () => {
    expect(calcPath(m({ measureType: 'flaeche', length: 4.5, width: 2.75, count: 2, area: 24.75 }))).toBe('2 × 4,50 × 2,75 = 24,75 m²');
    expect(
      calcPath(m({ measureType: 'wand', length: 5, width: 2.8, depth: 0.24, area: 12.11, deductions: [{ id: 't', label: 'Tür', count: 1, length: 0.9, width: 2.1 }] })),
    ).toBe('5,00 × 2,80 − 1,89 = 12,11 m² · × 0,24 = 2,91 m³');
    expect(calcPath(m({ measureType: 'laenge', kind: 'line', shape: line, length: 3, count: 2 }))).toBe('2 × 3,00 = 6,00 m');
    expect(calcPath(m({ measureType: 'volumen', length: 2, width: 1, depth: 0.5, area: 2 }))).toBe('2,00 × 1,00 × 0,50 = 1,00 m³');
    expect(calcPath(m({ measureType: 'stueck', kind: 'line', count: 4 }))).toBe('4 Stk');
    expect(calcPath(m({ measureType: 'frei', kind: 'line', qty: 8.2, unit: 'kg', formula: '2*3,5+1,2' }))).toBe('2*3,5+1,2 = 8,20 kg');
    expect(calcPath(m({ measureType: 'flaeche', length: 0, area: null }))).toBe('');
  });
});
