import { describe, expect, it } from 'vitest';
import { joinShapes, mirrorShape, offsetShape, reflectPoint, distanceToShape } from '../../src/lib/cad-ops';
import { lineShape, polygonArea, polygonShape, shapeVertices } from '../../src/lib/geometry';
import type { Shape } from '../../src/lib/types';

const pts = (s: Shape) => shapeVertices(s).map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
const L = (ax: number, ay: number, bx: number, by: number) => lineShape({ x: ax, y: ay }, { x: bx, y: by });

describe('Verbinden', () => {
  it('vier Linien eines Rechtecks → geschlossene Kontur (Fläche), Richtung egal', () => {
    const { chains } = joinShapes([L(0, 0, 4, 0), L(4, 3, 4, 0), L(4, 3, 0, 3), L(0, 3, 0, 0)], 0.001);
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(true);
    expect(chains[0].members.sort()).toEqual([0, 1, 2, 3]);
    expect(polygonArea(shapeVertices(chains[0].shape))).toBeCloseTo(12, 6);
  });
  it('kleine Lücke wird nur mit Toleranz geschlossen; Endpunkte exakt zusammengeführt', () => {
    const lines = [L(0, 0, 2, 0), L(2.03, 0.01, 2.03, 2)];
    const none = joinShapes(lines, 0.01);
    expect(none.chains).toHaveLength(0);
    expect(none.minGap).toBeCloseTo(Math.hypot(0.03, 0.01), 6);
    const ok = joinShapes(lines, 0.05);
    expect(ok.chains).toHaveLength(1);
    expect(ok.chains[0].closed).toBe(false);
    expect(pts(ok.chains[0].shape)).toEqual([[0, 0], [2, 0], [2.03, 2]]);
  });
  it('zwei gerade Linien in einer Flucht → eine Linie', () => {
    const { chains } = joinShapes([L(0, 0, 2, 0), L(2, 0, 5, 0)], 0.001);
    expect(chains[0].shape.type).toBe('line');
    expect(pts(chains[0].shape)).toEqual([[0, 0], [5, 0]]);
  });
  it('offene Polylinie, deren Enden sich berühren, wird geschlossen', () => {
    const { chains } = joinShapes([polygonShape([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 0.005 }], false)], 0.01);
    expect(chains[0].closed).toBe(true);
  });
});

describe('Versetzen', () => {
  it('Linie parallel auf die Seite des Punkts', () => {
    expect(pts(offsetShape(L(0, 0, 4, 0), 0.25, { x: 1, y: 1 })!)).toEqual([[0, 0.25], [4, 0.25]]);
    expect(pts(offsetShape(L(0, 0, 4, 0), 0.25, { x: 1, y: -1 })!)).toEqual([[0, -0.25], [4, -0.25]]);
  });
  it('Rechteck nach außen und innen (bleibt Rechteck, gleiche Mitte)', () => {
    const r: Shape = { type: 'rect', x: 0, y: 0, w: 4, h: 3 };
    expect(offsetShape(r, 0.5, { x: 10, y: 10 })).toMatchObject({ type: 'rect', x: -0.5, y: -0.5, w: 5, h: 4 });
    expect(offsetShape(r, 0.5, { x: 2, y: 1.5 })).toMatchObject({ x: 0.5, y: 0.5, w: 3, h: 2 });
    expect(offsetShape(r, 2, { x: 2, y: 1.5 })).toBeNull();
  });
  it('L-förmige Polylinie: Ecke auf Gehrung (Wand mit Stärke)', () => {
    const p = polygonShape([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], false);
    expect(pts(offsetShape(p, 0.3, { x: 1, y: 1 })!)).toEqual([[0, 0.3], [3.7, 0.3], [3.7, 3]]);
  });
  it('Fläche nach innen; zu weit nach innen → null', () => {
    const sq = polygonShape([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], true);
    expect(polygonArea(shapeVertices(offsetShape(sq, 0.5, { x: 1, y: 1 })!))).toBeCloseTo(1, 6);
    expect(offsetShape(sq, 1.5, { x: 1, y: 1 })).toBeNull();
    expect(polygonArea(shapeVertices(offsetShape(sq, 0.5, { x: 5, y: 5 })!))).toBeCloseTo(9, 6);
  });
  it('Abstand durch Punkt', () => {
    expect(distanceToShape(L(0, 0, 4, 0), { x: 2, y: 0.8 })).toBeCloseTo(0.8, 9);
    expect(distanceToShape({ type: 'ellipse', x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 1 })).toBeCloseTo(1, 9);
  });
});

describe('Spiegeln', () => {
  it('Punkt an senkrechter und schräger Achse', () => {
    expect(reflectPoint({ x: 1, y: 2 }, { x: 3, y: 0 }, { x: 3, y: 5 })).toEqual({ x: 5, y: 2 });
    const q = reflectPoint({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(q.x).toBeCloseTo(0, 9);
    expect(q.y).toBeCloseTo(1, 9);
  });
  it('Polylinie exakt gespiegelt; Rechteck bleibt Rechteck mit gespiegelter Drehung', () => {
    const p = polygonShape([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], false);
    expect(pts(mirrorShape(p, { x: 3, y: 0 }, { x: 3, y: 1 }))).toEqual([[6, 0], [4, 0], [4, 1]]);
    const r: Shape = { type: 'rect', x: 0, y: 0, w: 4, h: 2, rotation: 30 };
    const m = mirrorShape(r, { x: 10, y: 0 }, { x: 10, y: 1 }); // senkrechte Achse (90°)
    expect(m.type).toBe('rect');
    expect(m.rotation).toBeCloseTo(150, 9);
    expect(m.x + m.w / 2).toBeCloseTo(18, 9);
    // Text bleibt lesbar: Lage gespiegelt, Drehung bleibt
    expect(mirrorShape(r, { x: 10, y: 0 }, { x: 10, y: 1 }, true).rotation).toBe(30);
  });
});
