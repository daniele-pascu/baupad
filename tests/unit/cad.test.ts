import { describe, expect, it } from 'vitest';
import { arcRadius, arcShape, circleThrough, extendLine, rotateShapeBy, scaleShape, stretchShape, translateShape, trimLine } from '../../src/lib/cad';
import { pathLength } from '../../src/lib/drawing';
import { lineShape, shapeVertices } from '../../src/lib/geometry';
import type { Shape } from '../../src/lib/types';

const P = (x: number, y: number) => ({ x, y });
const near = (a: number, b: number, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);
const endsOf = (s: Shape) => {
  const v = shapeVertices(s);
  return [v[0], v[v.length - 1]];
};

describe('Ändern', () => {
  const rect: Shape = { type: 'rect', x: 0, y: 0, w: 4, h: 2 };
  it('Verschieben/Kopieren per Vektor', () => {
    expect(translateShape(rect, 1.5, -2)).toMatchObject({ x: 1.5, y: -2, w: 4, h: 2 });
  });
  it('Drehen um den Mittelpunkt, Skalieren um den Mittelpunkt', () => {
    expect(rotateShapeBy(rect, 90).rotation).toBe(90);
    expect(rotateShapeBy({ ...rect, rotation: 300 }, 60).rotation).toBeUndefined();
    expect(scaleShape(rect, 2)).toMatchObject({ x: -2, y: -1, w: 8, h: 4 });
  });
  it('Strecken: nur Punkte im Fenster bewegen sich (Rechteck → Trapez)', () => {
    const s = stretchShape(rect, { x: 3, y: -1, w: 2, h: 4 }, 1, 0)!; // rechte Seite +1 m
    const v = shapeVertices(s).map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]);
    expect(v).toEqual([[0, 0], [5, 0], [5, 2], [0, 2]]);
    expect(stretchShape(rect, { x: 10, y: 10, w: 1, h: 1 }, 1, 0)).toBeNull();
    // eine Ecke im Fenster → Trapez
    const t = stretchShape(rect, { x: 3.5, y: 1.5, w: 1, h: 1 }, 1, 0)!;
    expect(shapeVertices(t).map((p) => Math.round(p.x * 1e6) / 1e6)).toEqual([0, 4, 5, 0]);
    // Linie: Endpunkt strecken
    const l = stretchShape(lineShape(P(0, 0), P(2, 0)), { x: 1.5, y: -1, w: 1, h: 2 }, 3, 0)!;
    near(endsOf(l)[1].x, 5);
  });
});

describe('Trimmen und Verlängern', () => {
  const wall = lineShape(P(0, 0), P(10, 0));
  const c1 = lineShape(P(3, -2), P(3, 2));
  const c2 = lineShape(P(7, -2), P(7, 2));
  it('Mittelstück zwischen zwei Schnittpunkten entfernen → zwei Linien', () => {
    const r = trimLine(wall, P(5, 0.1), [c1, c2])!;
    expect(r).toHaveLength(2);
    near(endsOf(r[0])[1].x, 3);
    near(endsOf(r[1])[0].x, 7);
  });
  it('Ende bis zum Schnittpunkt abschneiden → eine Linie', () => {
    const r = trimLine(wall, P(9, 0), [c1, c2])!;
    expect(r).toHaveLength(1);
    near(endsOf(r[0])[0].x, 0);
    near(endsOf(r[0])[1].x, 7);
    expect(trimLine(wall, P(5, 0), [])).toBeNull();
  });
  it('Linie bis zur nächsten Begrenzung verlängern (in Klickrichtung)', () => {
    const short = lineShape(P(0, 0), P(2, 0));
    const r = extendLine(short, P(1.9, 0), [c1, c2])!;
    near(endsOf(r)[1].x, 3); // nächste Begrenzung, nicht die weiter entfernte
    near(endsOf(r)[0].x, 0);
    expect(extendLine(short, P(0.1, 0), [c1, c2])).toBeNull(); // links ist nichts
  });
});

describe('Bogen aus drei Punkten', () => {
  it('Halbkreis r = 2: Länge π·r, Radius aus der gespeicherten Form', () => {
    const k = circleThrough(P(-2, 0), P(0, -2), P(2, 0))!;
    near(k.r, 2);
    const a = arcShape(P(-2, 0), P(0, -2), P(2, 0))!;
    expect(a.closed).toBe(false);
    near(pathLength(a), Math.PI * 2, 0.005);
    near(arcRadius(a)!, 2, 1e-4);
    // Bogen läuft durch den mittleren Punkt (oben), nicht unten herum
    expect(Math.min(...shapeVertices(a).map((p) => p.y))).toBeLessThan(-1.99);
  });
  it('drei Punkte auf einer Geraden: kein Bogen', () => {
    expect(arcShape(P(0, 0), P(1, 0), P(2, 0))).toBeNull();
  });
});
