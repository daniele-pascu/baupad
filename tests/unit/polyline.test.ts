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
  const { dashArray, wavyPoints, fillOf, fitDash, strokeGeometry, wavyMetrics } = await import('../../src/lib/style');
  it('Strichmuster skalieren mit der Linienstärke', () => {
    expect(dashArray('solid', 2)).toBeUndefined();
    expect(dashArray('dashed', 2)).toEqual([10, 6]);
    expect(dashArray('dashdotdot', 1)).toEqual([8, 2.6, 0, 2.6, 0, 2.6]);
  });
  it('Strichmuster gehen auf der Linie ganzzahlig auf (offen: Strich am Anfang und Ende)', () => {
    const d = fitDash([10, 6], 100, false);
    const period = d[0] + d[1];
    const n = (100 - d[0]) / period;
    close(n, Math.round(n));
    expect(Math.abs(d[0] - 10)).toBeLessThan(5);
    // geschlossen: nahtlos
    const c = fitDash([10, 6], 150, true);
    close(150 / (c[0] + c[1]), Math.round(150 / (c[0] + c[1])));
    // Geometrie unverändert: der Pfad der Linie ist derselbe, nur das Muster passt sich an
    const line = polygonShape([P(0, 0), P(100, 0)], false);
    const g = strokeGeometry(line, (p) => p, 'dashed', 2);
    expect(g.d).toBe('M0 0L100 0');
    expect(g.dash).toHaveLength(2);
  });
  it('Welle/Zickzack fein: kleiner Ausschlag, Muster endet sauber auf der Linie', () => {
    for (const t of ['wave', 'zigzag'] as const) {
      const m = wavyMetrics(t, 1.76); // Standardstärke am Bildschirm (1,1 pt)
      expect(m.amp).toBeLessThan(2.2);
      expect(m.period).toBeLessThan(10.5);
      const pts = wavyPoints([P(0, 0), P(97, 0)], false, t, m.amp, m.period);
      expect(Math.abs(pts.at(-1)!.y)).toBeLessThan(1e-6); // ganzzahlige Wiederholungen: Ende auf der Linie
      expect(pts.at(-1)!.x).toBeCloseTo(97, 9);
    }
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

describe('Schraffur (nur Darstellung)', async () => {
  const { hatchGeometry, fillOf } = await import('../../src/lib/style');
  const sq = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
  it('waagrechte Linien im Abstand, auf die Fläche beschnitten', () => {
    const h = hatchGeometry(sq, 'lines', 0, 10);
    expect(h.segments).toHaveLength(10); // y = 0, 10 … 90 (Oberkante 100 liegt auf dem Rand)
    for (const [a, b] of h.segments) {
      close(a.x, 0);
      close(b.x, 100);
    }
  });
  it('45°-Linien bleiben innerhalb, Kreuzschraffur doppelt so viele, Punkte im Raster', () => {
    const h = hatchGeometry(sq, 'lines', 45, 10);
    for (const [a, b] of h.segments) for (const p of [a, b]) expect(p.x >= -1e-6 && p.x <= 100 + 1e-6 && p.y >= -1e-6 && p.y <= 100 + 1e-6).toBe(true);
    const cross = hatchGeometry(sq, 'cross', 0, 10).segments.length;
    expect(cross).toBeGreaterThanOrEqual(20); // je Richtung 10 (eine Randlinie kann durch Rundung dazukommen)
    expect(cross).toBeLessThanOrEqual(22);
    expect(hatchGeometry(sq, 'dots', 0, 10).dots.length).toBe(110); // 10 Zeilen × 11 Punkte
  });
  it('L-Form: Linien über der Aussparung werden geteilt (gerade-ungerade-Regel)', () => {
    const L = [P(0, 0), P(100, 0), P(100, 40), P(40, 40), P(40, 100), P(0, 100)];
    const h = hatchGeometry(L, 'lines', 90, 10); // senkrechte Linien
    const total = h.segments.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0);
    expect(total).toBeGreaterThan(0);
    for (const [a, b] of h.segments) expect(Math.max(a.y, b.y) <= 100 + 1e-6).toBe(true);
  });
  it('Schraffur ohne eigene Transparenz ist deckend', () => {
    const f = fillOf(polygonShape(sq), '#000', { fillType: 'hatch' }, 88)!;
    expect(f.opacity).toBe(1);
    expect(f.hatch).toMatchObject({ pattern: 'lines', angle: 45 });
  });
});
