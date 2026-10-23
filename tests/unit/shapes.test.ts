import { describe, expect, it } from 'vitest';
import {
  freehandPoints,
  freehandShape,
  hitShape,
  normalizeRotation,
  pathToSvg,
  resizeRotatedShape,
  rotatePoint,
  shapeAABB,
  shapePath,
} from '../../src/lib/geometry';
import type { Shape } from '../../src/lib/types';

describe('Freihand: genau wie gezeichnet', () => {
  const zickzack = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: i % 2 ? 4 : 0 }));

  it('jeder gezeichnete Punkt bleibt erhalten (keine Glättung)', () => {
    const s = freehandShape(zickzack, 0.5, 5)!;
    expect(s.points).toHaveLength(40);
    const back = freehandPoints(s);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(zickzack[i].x, 3);
      expect(p.y).toBeCloseTo(zickzack[i].y, 3);
    });
  });

  it('offene Linie (z. B. Riss) bleibt offen – kein Schließen, keine Fläche', () => {
    const s = freehandShape(zickzack, 0.5, 5)!;
    expect(s.closed).toBe(false);
    expect(pathToSvg(shapePath(s))).not.toContain('Z');
    // Treffer nur auf der Linie, nicht in der „Fläche“ zwischen Anfang und Ende
    expect(hitShape(s, { x: 30, y: 2 }, 3)).toBe(true);
    expect(hitShape(s, { x: 60, y: 40 }, 3)).toBe(false);
  });

  it('nahe am Startpunkt beendet → geschlossene Fläche', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
      { x: 2, y: 3 },
    ];
    const s = freehandShape(ring, 0.5, 5)!;
    expect(s.closed).toBe(true);
    expect(pathToSvg(shapePath(s))).toContain('Z');
    expect(hitShape(s, { x: 25, y: 25 }, 0)).toBe(true);
  });

  it('doppelte Punkte (Finger steht still) entfallen', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }];
    expect(freehandShape(pts, 0.5, 1)!.points).toHaveLength(3);
  });
});

describe('Drehen', () => {
  const rect: Shape = { type: 'rect', x: 0, y: 0, w: 100, h: 20 };

  it('Drehpunkt ist die Mitte, 90° stellt das Rechteck hochkant', () => {
    const r = { ...rect, rotation: 90 };
    const b = shapeAABB(r);
    expect(b.x).toBeCloseTo(40, 6);
    expect(b.y).toBeCloseTo(-40, 6);
    expect(b.w).toBeCloseTo(20, 6);
    expect(b.h).toBeCloseTo(100, 6);
  });

  it('Trefferprüfung berücksichtigt die Drehung', () => {
    const r = { ...rect, rotation: 90 };
    expect(hitShape(r, { x: 50, y: -35 }, 0)).toBe(true); // oben in der gedrehten Form
    expect(hitShape(r, { x: 90, y: 10 }, 0)).toBe(false); // ungedreht wäre das ein Treffer
  });

  it('Größenänderung einer gedrehten Form hält die gegenüberliegende Seite fest', () => {
    const r: Shape = { ...rect, rotation: 30 };
    const c = { x: 50, y: 10 };
    const fixedBefore = rotatePoint({ x: 0, y: 10 }, c, 30); // Mitte der linken Kante
    const eastHandle = rotatePoint({ x: 140, y: 10 }, c, 30); // Zeiger 40 weiter nach „rechts“
    const out = resizeRotatedShape(r, 'e', eastHandle, 1);
    expect(out.w).toBeCloseTo(140, 6);
    const oc = { x: out.x + out.w / 2, y: out.y + out.h / 2 };
    const fixedAfter = rotatePoint({ x: out.x, y: out.y + out.h / 2 }, oc, 30);
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 6);
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 6);
  });

  it('rastet nahe 15°-Schritten ein und normalisiert auf 0–360°', () => {
    expect(normalizeRotation(88)).toBe(90);
    expect(normalizeRotation(-3)).toBe(0);
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(52)).toBe(52);
  });

  it('Kreis/Ellipse: Begrenzung der gedrehten Ellipse ist exakt', () => {
    const e: Shape = { type: 'ellipse', x: 0, y: 0, w: 100, h: 20, rotation: 90 };
    const b = shapeAABB(e);
    expect(b.w).toBeCloseTo(20, 6);
    expect(b.h).toBeCloseTo(100, 6);
  });
});
