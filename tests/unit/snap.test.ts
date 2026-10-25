import { describe, expect, it } from 'vitest';
import { planUnitsPerMeter } from '../../src/lib/calibration';
import { lineShape, polygonShape } from '../../src/lib/geometry';
import { findSnap, segmentIntersection } from '../../src/lib/snap';
import type { Plan, Shape } from '../../src/lib/types';

const P = (x: number, y: number) => ({ x, y });
const rect: Shape = { type: 'rect', x: 0, y: 0, w: 100, h: 50 };
const cross = lineShape(P(50, -20), P(50, 80)); // schneidet die Ober- und Unterkante bei x = 50

describe('Punktfang', () => {
  it('Endpunkt/Ecke vor allem anderen', () => {
    expect(findSnap(P(2, 1), [rect], 5)).toEqual({ point: P(0, 0), kind: 'end' });
  });
  it('Schnittpunkt zweier Linien', () => {
    // Mitte der Oberkante (50,0) ist zugleich Schnittpunkt – Schnittpunkt hat Vorrang vor Mittelpunkt
    expect(findSnap(P(51, 1), [rect, cross], 5)).toEqual({ point: P(50, 0), kind: 'intersection' });
  });
  it('Mittelpunkt einer Kante', () => {
    expect(findSnap(P(1, 26), [rect], 5)).toEqual({ point: P(0, 25), kind: 'mid' });
  });
  it('nächster Punkt auf der Linie, wenn sonst nichts in Reichweite', () => {
    const hit = findSnap(P(80, 2), [rect], 5)!;
    expect(hit.kind).toBe('nearest');
    expect(hit.point.x).toBeCloseTo(80, 9);
    expect(hit.point.y).toBeCloseTo(0, 9);
  });
  it('Kreismitte und kein Treffer außerhalb des Radius', () => {
    const c: Shape = { type: 'ellipse', x: 200, y: 0, w: 40, h: 40 };
    expect(findSnap(P(221, 19), [c], 3)).toEqual({ point: P(220, 20), kind: 'center' });
    expect(findSnap(P(300, 300), [rect, c], 5)).toBeNull();
  });
  it('Genauigkeit unabhängig vom Radius (Zoom): gleicher Punkt bei kleinem und großem Radius', () => {
    expect(findSnap(P(0.4, 0.3), [rect], 0.5)!.point).toEqual(P(0, 0));
    expect(findSnap(P(4, 3), [rect], 8)!.point).toEqual(P(0, 0));
  });
  it('Schnittpunkte innerhalb einer Polylinie (nicht benachbarte Kanten)', () => {
    const z = polygonShape([P(0, 0), P(10, 10), P(10, 0), P(0, 10)], false); // Kanten 0 und 2 kreuzen sich bei (5,5)
    const hit = findSnap(P(5.5, 5.2), [z], 2)!;
    expect(hit.kind).toBe('intersection');
    expect(hit.point.x).toBeCloseTo(5, 6);
    expect(hit.point.y).toBeCloseTo(5, 6);
    expect(segmentIntersection([P(0, 0), P(1, 0)], [P(0, 1), P(1, 1)])).toBeNull(); // parallel
  });
});

describe('Kalibrierung', () => {
  const base = { pageWidth: 1000, pageHeight: 700, crop: null, planNumber: '1' } as Plan;
  it('ohne Kalibrierung kein Maßstab, mit Strecke 200 Einheiten = 5 m → 40 Einheiten je m', () => {
    expect(planUnitsPerMeter(base)).toBeNull();
    expect(planUnitsPerMeter({ ...base, calibration: { a: P(100, 100), b: P(220, 260), meters: 5 } })).toBeCloseTo(40, 9);
  });
  it('gezeichnete Pläne behalten ihren festen Maßstab', () => {
    expect(planUnitsPerMeter({ ...base, source: 'drawing', drawing: { unit: 'm', unitsPerMeter: 100 } })).toBe(100);
  });
});
