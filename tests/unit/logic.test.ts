import { describe, expect, it } from 'vitest';
import { checkMeasure, computeArea, formatArea, formatMeasure, parseDecimal } from '../../src/lib/numbers';
import { compactNumbers, duplicateNumbers, nextNumber, parseDamageNumber, planNumberStart, shiftNumbers, swapNumbers } from '../../src/lib/numbering';
import { fitView, freehandShape, hitShape, layoutLabels, rectsOverlap, resizeShape, toPage, toScreen, zoomAt } from '../../src/lib/geometry';
import { colName, sheetName } from '../../src/lib/xlsx';
import { safeFileName } from '../../src/lib/aufmass';
import { quantityFor } from '../../src/lib/measure';

describe('Zahleneingabe', () => {
  it('akzeptiert Komma und Punkt', () => {
    expect(parseDecimal('1,25')).toBe(1.25);
    expect(parseDecimal('1.25')).toBe(1.25);
    expect(parseDecimal(' 0,05 m')).toBe(0.05);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('2')).toBe(2);
  });
  it('lehnt ungültige Eingaben ab', () => {
    for (const s of ['', 'abc', '1,2,3', '1.2.3', '1e5', '--1', '1,5x']) expect(parseDecimal(s)).toBeNull();
  });
  it('prüft positive Pflichtwerte', () => {
    expect(checkMeasure('', 'Länge').ok).toBe(false);
    expect(checkMeasure('0', 'Länge').ok).toBe(false);
    expect(checkMeasure('-1', 'Länge').ok).toBe(false);
    expect(checkMeasure('x', 'Länge').ok).toBe(false);
    expect(checkMeasure('1,5', 'Länge')).toEqual({ ok: true, value: 1.5 });
  });
});

describe('Flächenberechnung', () => {
  it('Länge × Breite, Tiefe nicht einbezogen', () => {
    expect(computeArea(1.5, 0.8)).toBe(1.2);
    expect(computeArea(0.1, 0.2)).toBe(0.02);
    expect(computeArea(1.255, 1)).toBe(1.255); // keine vorzeitige Rundung
    expect(formatArea(1.2)).toBe('1,20');
    expect(formatArea(1234.5)).toBe('1.234,50');
    expect(formatMeasure(0.05)).toBe('0,05');
    expect(formatMeasure(0.125)).toBe('0,125');
  });
});

describe('Nummerierung', () => {
  const d = (id: string, number: number) => ({ id, number });
  it('beginnt bei 1 und zählt hoch', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([d('a', 1), d('b', 2)])).toBe(3);
    expect(nextNumber([], 5)).toBe(5);
  });
  it('ältere Pläne mit Startnummer 0 beginnen ebenfalls bei 1', () => {
    expect(planNumberStart({ numberStart: 0 })).toBe(1);
    expect(planNumberStart({ numberStart: 10 })).toBe(10);
    expect(parseDamageNumber('0')).toBeNull();
    expect(parseDamageNumber('7')).toBe(7);
  });
  it('nummeriert beim Löschen nicht automatisch um', () => {
    // Nr. 2 gelöscht → Nummern 1 und 3 bleiben, nächste ist 4
    expect(nextNumber([d('a', 1), d('c', 3)])).toBe(4);
  });
  it('tauscht Nummern', () => {
    const list = [d('a', 0), d('b', 1), d('c', 2)];
    expect([...swapNumbers(list, 'c', 0)]).toEqual([
      ['c', 0],
      ['a', 2],
    ]);
  });
  it('verschiebt nachfolgende Nummern bis zur Lücke', () => {
    const list = [d('a', 0), d('b', 1), d('c', 2), d('e', 5), d('x', 7)];
    const ch = shiftNumbers(list, 'x', 1);
    expect(Object.fromEntries(ch)).toEqual({ x: 1, b: 2, c: 3 });
    const after = list.map((i) => ({ ...i, number: ch.get(i.id) ?? i.number }));
    expect(duplicateNumbers(after)).toEqual([]);
  });
  it('nummeriert lückenlos neu – immer ab 1', () => {
    const ch = compactNumbers([d('a', 0), d('c', 2), d('e', 5)]);
    expect(Object.fromEntries(ch)).toEqual({ a: 1, e: 3 }); // c behält die 2
  });
  it('erkennt doppelte Nummern', () => {
    expect(duplicateNumbers([d('a', 1), d('b', 1), d('c', 2)])).toEqual([1]);
  });
});

describe('Geometrie', () => {
  it('Bildschirm ↔ Seite sind invers', () => {
    const v = { scale: 2.5, tx: 30, ty: -12 };
    const p = { x: 123.4, y: 56.7 };
    const q = toPage(v, toScreen(v, p));
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });
  it('Zoom hält den Punkt unter dem Finger fest', () => {
    const v = fitView({ x: 0, y: 0, w: 1000, h: 700 }, 800, 600);
    const c = { x: 300, y: 200 };
    const before = toPage(v, c);
    const z = zoomAt(v, c, 3, 0.01, 100);
    const after = toPage(z, c);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
  it('Trefferprüfung Ellipse', () => {
    const s = { type: 'ellipse' as const, x: 0, y: 0, w: 100, h: 50 };
    expect(hitShape(s, { x: 50, y: 25 }, 0)).toBe(true);
    expect(hitShape(s, { x: 2, y: 2 }, 0)).toBe(false);
  });
  it('Freihand wird relativ zum Rahmen gespeichert und skaliert', () => {
    const s = freehandShape(
      [
        { x: 10, y: 10 },
        { x: 50, y: 12 },
        { x: 60, y: 40 },
        { x: 20, y: 45 },
        { x: 11, y: 12 },
      ],
      0.5,
      5,
    )!;
    expect(s.closed).toBe(true);
    expect(s.x).toBe(10);
    expect(s.points!.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1)).toBe(true);
    const r = resizeShape(s, 'se', { x: 110, y: 85 }, 1);
    expect(r.w).toBe(100);
    expect(r.points).toEqual(s.points);
  });
  it('Beschriftungen überlappen nicht', () => {
    const items = [0, 1, 2].map((i) => ({ id: String(i), bounds: { x: 100 + i * 2, y: 100, w: 10, h: 10 }, w: 14, h: 12, offset: null }));
    const res = [...layoutLabels(items, 2).values()];
    for (let i = 0; i < res.length; i++) for (let j = i + 1; j < res.length; j++) expect(rectsOverlap(res[i], res[j])).toBe(false);
  });
});

describe('Export-Hilfen', () => {
  it('Spaltennamen', () => {
    expect(colName(0)).toBe('A');
    expect(colName(5)).toBe('F');
    expect(colName(26)).toBe('AA');
  });
  it('gültige, eindeutige Blattnamen', () => {
    const used = new Set<string>();
    expect(sheetName('Decke über EG/OG [neu]', used)).toBe('Decke über EG OG  neu');
    expect(sheetName('Tiefgarage', used)).toBe('Tiefgarage');
    expect(sheetName('tiefgarage', used)).toBe('tiefgarage (2)');
    expect(sheetName('x'.repeat(40), used).length).toBeLessThanOrEqual(31);
  });
  it('Dateinamen', () => {
    expect(safeFileName('Wohnanlage Süd', 'Tiefgarage', 'Aufmass')).toBe('Wohnanlage_Sued_Tiefgarage_Aufmass');
    expect(safeFileName('A/B: C?', '', 'Plan')).toBe('A-B-_C_Plan');
  });
});

describe('Mengen je LV-Einheit', () => {
  const ds = [
    { kind: 'area' as const, length: 2, area: 3, depth: 0.1 },
    { kind: 'line' as const, length: 4, area: null, depth: null },
    { kind: 'damage' as const, length: 1, area: 0.5, depth: null },
  ];
  it('m² summiert nur Flächen, Linien werden als fehlend gezählt', () => {
    expect(quantityFor('m²', ds)).toEqual({ value: 3.5, missing: 1 });
  });
  it('m summiert Längen, Stk zählt, m³ nur mit Tiefe', () => {
    expect(quantityFor('m', ds).value).toBe(7);
    expect(quantityFor('Stk', ds).value).toBe(3);
    expect(quantityFor('m³', ds)).toEqual({ value: 0.3, missing: 2 });
  });
  it('PA, h, Wo sind nicht aus Messungen ableitbar', () => {
    expect(quantityFor('PA', ds).value).toBeNull();
  });
});
