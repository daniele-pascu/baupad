import { describe, expect, it } from 'vitest';
import { annotationsOf, pathLength, shapeInfo } from '../../src/lib/drawing';
import { insertVertex, isOpenShape, nearestEdge, polygonShape, removeVertex, setPolylineClosed, shapeVertices } from '../../src/lib/geometry';
import type { Shape } from '../../src/lib/types';

const P = (x: number, y: number) => ({ x, y });
// Eckpunkte werden relativ zum Rahmen mit 6 Nachkommastellen gespeichert → Toleranz 0,1 mm²
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-4);

describe('Polylinie offen/geschlossen', () => {
  const pts = [P(0, 0), P(4, 0), P(4, 3)];

  it('offen: nur Länge (Summe der Abschnitte), keine Fläche', () => {
    const s = polygonShape(pts, false);
    expect(isOpenShape(s)).toBe(true);
    close(pathLength(s), 7);
    expect(shapeInfo({ type: 'freehand', shape: s })).toBeNull();
    // Maße je Abschnitt, ohne Schlusskante
    expect(annotationsOf({ type: 'freehand', shape: s }).dims.map((d) => d.text)).toEqual(['4,00 m', '3,00 m']);
  });

  it('geschlossen: Fläche und Umfang inkl. Schlusskante', () => {
    const s = polygonShape(pts, true);
    const info = shapeInfo({ type: 'freehand', shape: s })!;
    close(info.area!, 6);
    close(info.perimeter, 12);
    expect(annotationsOf({ type: 'freehand', shape: s }).dims).toHaveLength(3);
  });

  it('unregelmäßige Fläche mit vielen Eckpunkten (L-Form 1,38 m genau)', () => {
    const L = [P(0, 0), P(5.12, 0), P(5.12, 1.38), P(2, 1.38), P(2, 4.07), P(0, 4.07)];
    const info = shapeInfo({ type: 'freehand', shape: polygonShape(L) })!;
    close(info.area!, 5.12 * 1.38 + 2 * (4.07 - 1.38));
    close(info.perimeter, 2 * (5.12 + 4.07));
  });

  it('öffnen/schließen', () => {
    const open = polygonShape(pts, false);
    expect(setPolylineClosed(open, true)!.closed).toBe(true);
    expect(setPolylineClosed(polygonShape([P(0, 0), P(1, 1)], false), true)).toBeNull(); // 2 Punkte: keine Fläche
    expect(setPolylineClosed({ type: 'rect', x: 0, y: 0, w: 1, h: 1 }, false)).toBeNull();
  });
});

describe('Eckpunkte einfügen/entfernen', () => {
  const square = polygonShape([P(0, 0), P(2, 0), P(2, 2), P(0, 2)]);

  it('Kante finden und Punkt einfügen', () => {
    const near = nearestEdge(square, P(1, -0.1))!;
    expect(near.edge).toBe(0);
    close(near.point.x, 1);
    close(near.point.y, 0);
    const s = insertVertex(square, near.edge, P(1, -1));
    expect(shapeVertices(s)).toHaveLength(5);
    close(shapeInfo({ type: 'freehand', shape: s })!.area!, 5); // 4 + Dreieck 1
  });

  it('Schlusskante einer geschlossenen Form wird berücksichtigt, bei offener nicht', () => {
    expect(nearestEdge(square, P(-0.1, 1))!.edge).toBe(3);
    const open = polygonShape([P(0, 0), P(2, 0), P(2, 2), P(0, 2)], false);
    expect(nearestEdge(open, P(-0.1, 1))!.edge).not.toBe(3);
  });

  it('Punkt entfernen, Mindestzahl bleibt (Fläche 3, offene Linie 2)', () => {
    const tri = removeVertex(square, 2)!;
    expect(shapeVertices(tri)).toHaveLength(3);
    close(shapeInfo({ type: 'freehand', shape: tri })!.area!, 2);
    expect(removeVertex(tri, 0)).toBeNull();
    const open = polygonShape([P(0, 0), P(1, 0), P(2, 1)], false);
    const two = removeVertex(open, 1)!;
    expect(two.closed).toBe(false);
    expect(removeVertex(two, 0)).toBeNull();
  });

  it('Linie mit eingefügtem Punkt = offene Polylinie, Rechteck = geschlossene', () => {
    const line: Shape = { type: 'line', x: 0, y: 0, w: 4, h: 1e-6, points: [[0, 0], [1, 0]] };
    const pl = insertVertex(line, 0, P(2, 1));
    expect(pl).toMatchObject({ type: 'freehand', closed: false });
    close(pathLength(pl), 2 * Math.hypot(2, 1));
    const rect = insertVertex({ type: 'rect', x: 0, y: 0, w: 2, h: 1 }, 0, P(1, 0));
    expect(rect).toMatchObject({ type: 'freehand', closed: true });
    close(shapeInfo({ type: 'freehand', shape: rect })!.area!, 2);
  });
});

describe('Linienstile (nur Darstellung)', async () => {
  const { dashArray, wavyPoints, fillOf } = await import('../../src/lib/style');
  it('Strichmuster skalieren mit der Linienstärke', () => {
    expect(dashArray('solid', 2)).toBeUndefined();
    expect(dashArray('dashed', 2)).toEqual([12, 7]);
    expect(dashArray('dashdotdot', 1)).toEqual([7, 2.5, 0, 2.5, 0, 2.5]);
  });
  it('Zickzack/Welle bleiben im Abstand der Amplitude um die Linie, Länge der Geometrie unverändert', () => {
    const base = [P(0, 0), P(100, 0)];
    for (const t of ['zigzag', 'wave'] as const) {
      const pts = wavyPoints(base, false, t, 3, 10);
      expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeLessThanOrEqual(3 + 1e-9);
      expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeGreaterThan(2.9);
      expect(pts[0].x).toBe(0);
      expect(pts.at(-1)!.x).toBeCloseTo(100, 9);
    }
    close(pathLength(polygonShape(base, false)), 100);
  });
  it('Füllung: offen nie, „Keine Füllung“, Transparenz', () => {
    const sq = polygonShape([P(0, 0), P(1, 0), P(1, 1)]);
    expect(fillOf(polygonShape([P(0, 0), P(1, 0)], false), '#000', {}, 88)).toBeNull();
    expect(fillOf(sq, '#000', { noFill: true }, 88)).toBeNull();
    expect(fillOf(sq, '#000', { fillTransparency: 0, fillColor: '#f00' }, 88)).toEqual({ color: '#f00', opacity: 1 });
    expect(fillOf(sq, '#000', {}, 88)!.opacity).toBeCloseTo(0.12, 9);
    expect(fillOf(sq, '#000', { fillTransparency: 100 }, 88)!.opacity).toBe(0);
  });
});
