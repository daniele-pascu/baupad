import { describe, expect, it } from 'vitest';
import { angleBetween, filletCorner, filletLines, lineLineIntersection, pointLineDistance, segSegDistance } from '../../src/lib/cad-ops';
import { findSnap, normalizeSnapKinds, OBJECT_SNAPS } from '../../src/lib/snap';
import type { Shape } from '../../src/lib/types';

const P = (x: number, y: number) => ({ x, y });
const close = (a: number, b: number, e = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('Abrunden', () => {
  it('zwei Linien, die sich nicht berühren: Ecke mit Radius 1', () => {
    // waagrecht von (0|0) bis (4|0), senkrecht von (5|1) bis (5|5) – Schnitt bei (5|0)
    const r = filletLines([P(0, 0), P(4, 0)], P(1, 0), [P(5, 1), P(5, 5)], P(5, 4), 1);
    if ('error' in r) throw new Error(r.error);
    expect(r.a[0]).toEqual(P(0, 0));
    close(r.a[1].x, 4);
    close(r.a[1].y, 0);
    close(r.b[1].x, 5);
    close(r.b[1].y, 1);
    // Bogenmitte: Kreismitte (4|1), Mitte des Bogens Richtung Ecke
    close(r.arc![1].x, 4 + Math.SQRT1_2);
    close(r.arc![1].y, 1 - Math.SQRT1_2);
  });
  it('Radius 0 = scharfe Ecke (Linien verlängert bzw. gekürzt)', () => {
    const r = filletLines([P(0, 0), P(6, 0)], P(1, 0), [P(5, -1), P(5, 5)], P(5, 4), 0);
    if ('error' in r) throw new Error(r.error);
    expect(r.arc).toBeNull();
    expect(r.a).toEqual([P(0, 0), P(5, 0)]);
    expect(r.b).toEqual([P(5, 5), P(5, 0)]);
  });
  it('angetippter Teil bleibt: Linie über den Schnitt hinaus, rechter Teil gewählt', () => {
    const r = filletLines([P(0, 0), P(10, 0)], P(9, 0), [P(5, -5), P(5, 5)], P(5, 4), 0);
    if ('error' in r) throw new Error(r.error);
    expect(r.a[0]).toEqual(P(10, 0));
  });
  it('parallel bzw. Radius zu groß → Fehler', () => {
    expect('error' in filletLines([P(0, 0), P(1, 0)], P(0, 0), [P(0, 1), P(1, 1)], P(0, 1), 1)).toBe(true);
    expect('error' in filletLines([P(0, 0), P(1, 0)], P(0, 0), [P(2, 1), P(2, 2)], P(2, 2), 5)).toBe(true);
  });
  it('Ecke einer Fläche: Quadrat 4×4, Ecke mit Radius 1 – Fläche um (1 − π/4) kleiner', () => {
    const sq = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    const out = filletCorner(sq, true, 1, 1, 64);
    if ('error' in out) throw new Error(out.error);
    const area = Math.abs(out.reduce((a, p, i) => a + p.x * out[(i + 1) % out.length].y - out[(i + 1) % out.length].x * p.y, 0) / 2);
    close(area, 16 - (1 - Math.PI / 4), 1e-3);
    expect('error' in filletCorner(sq, false, 0, 1)).toBe(true);
  });
});

describe('Abstände', () => {
  it('Schnitt, kürzester Abstand, Winkel, Lot', () => {
    expect(lineLineIntersection([P(0, 0), P(1, 0)], [P(3, 1), P(3, 2)])).toEqual(P(3, 0));
    const d = segSegDistance([P(0, 0), P(4, 0)], [P(1, 2), P(3, 2)]);
    close(d.d, 2);
    expect(segSegDistance([P(0, 0), P(4, 0)], [P(2, -1), P(2, 1)]).d).toBe(0);
    close(angleBetween([P(0, 0), P(1, 0)], [P(0, 0), P(0, 1)]), 90);
    close(angleBetween([P(0, 0), P(1, 0)], [P(5, 5), P(2, 5)]), 0);
    close(pointLineDistance(P(10, 3), [P(0, 0), P(1, 0)]).d, 3);
  });
});

describe('Objektfang-Arten', () => {
  const line: Shape = { type: 'line', x: 0, y: 0, w: 10, h: 0, points: [[0, 0], [1, 0]] };
  const circle: Shape = { type: 'ellipse', x: 0, y: 10, w: 4, h: 4 };
  it('Lotpunkt vom letzten Punkt auf eine Linie', () => {
    const hit = findSnap(P(3.05, 0.05), [line], 0.2, [], { from: P(3, 5) });
    expect(hit?.kind).toBe('perpendicular');
    close(hit!.point.x, 3);
  });
  it('Tangente und Quadrant am Kreis; abgeschaltete Art wird übergangen', () => {
    // Kreis Mitte (2|12), r 2; vom Punkt (2|8) (Abstand 4) Tangentenpunkte bei 60° zur Verbindung
    const t = { x: 2 + 2 * Math.sin(Math.PI / 3), y: 12 - 2 * Math.cos(Math.PI / 3) };
    const hit = findSnap(P(t.x + 0.02, t.y), [circle], 0.15, [], { from: P(2, 8) });
    expect(hit?.kind).toBe('tangent');
    close(hit!.point.x, t.x, 1e-9);
    expect(findSnap(P(4.02, 12), [circle], 0.15)?.kind).toBe('quadrant');
    expect(findSnap(P(4.02, 12), [circle], 0.15, [], { kinds: ['end', 'nearest'] })?.kind).toBe('nearest');
  });
  it('Bogenmitte über circles, Hilfslinien als Fanglinien (Schnitt)', () => {
    expect(findSnap(P(50.1, 50), [], 0.3, [], { circles: [{ c: P(50, 50), r: 3 }] })?.kind).toBe('center');
    const hit = findSnap(P(5.05, 0.05), [line], 0.2, [], { lines: [[P(5, -100), P(5, 100)]] });
    expect(hit?.kind).toBe('intersection');
  });
  it('Vorrang: Reihenfolge entscheidet, gespeicherte Einstellung wird bereinigt', () => {
    // Endpunkt (0|0) und Lotpunkt bei (0.1|0) im Fangradius: Lotpunkt zuerst gereiht gewinnt
    const order = ['perpendicular', 'end', 'nearest'] as const;
    expect(findSnap(P(0.05, 0), [line], 0.2, [], { from: P(0.1, 3), kinds: [...order] })?.kind).toBe('perpendicular');
    expect(findSnap(P(0.05, 0), [line], 0.2, [], { from: P(0.1, 3) })?.kind).toBe('end');
    const n = normalizeSnapKinds(['mid', 'unbekannt', 'end'], ['mid']);
    expect(n.order.slice(0, 2)).toEqual(['mid', 'end']);
    expect(n.order).toHaveLength(OBJECT_SNAPS.length);
    expect(n.enabled).toContain('mid');
    expect(n.enabled).not.toContain('end');
  });
});
