import { describe, expect, it } from 'vitest';
import { pointLineDistance, refGuide } from '../../src/lib/cad-ops';

// Beispiel aus der Vorgabe: A (1000 | 1000), B (5000 | 1000) in mm → hier in m
const A = { x: 1, y: 1 };
const B = { x: 5, y: 1 };
/** Strecke der Hilfslinie (wie guideSeg: Winkel gegen den Uhrzeigersinn, y nach unten) */
const seg = (g: { x: number; y: number; angle: number }) => {
  const r = (g.angle * Math.PI) / 180;
  return [{ x: g.x - Math.cos(r) * 100, y: g.y + Math.sin(r) * 100 }, { x: g.x + Math.cos(r) * 100, y: g.y - Math.sin(r) * 100 }] as [typeof A, typeof A];
};

describe('Hilfslinie aus zwei Bezugspunkten', () => {
  it('parallel im Abstand 0,25 m: exakt 0,25 m von der Bezugslinie, auf der Seite des Zeigers', () => {
    const below = refGuide(A, B, 'par', { x: 3, y: 4 }, 0.25);
    expect(below.angle).toBeCloseTo(0);
    expect(below.y).toBeCloseTo(1.25);
    const above = refGuide(A, B, 'par', { x: 3, y: -2 }, 0.25);
    expect(above.y).toBeCloseTo(0.75);
    // beide Bezugspunkte liegen genau 0,25 m von der Hilfslinie entfernt
    for (const p of [A, B]) expect(pointLineDistance(p, seg(below)).d).toBeCloseTo(0.25);
    // negativer Abstand = andere Seite
    expect(refGuide(A, B, 'par', { x: 3, y: 4 }, -0.25).y).toBeCloseTo(0.75);
  });
  it('senkrecht im Abstand entlang der Bezugslinie: 2,5 m von A in Richtung des Zeigers', () => {
    const g = refGuide(A, B, 'perp', { x: 4, y: 3 }, 2.5);
    expect(g.angle).toBeCloseTo(90);
    expect(g.x).toBeCloseTo(3.5);
    expect(refGuide(A, B, 'perp', { x: -4, y: 3 }, 2.5).x).toBeCloseTo(-1.5); // Zeiger hinter A
  });
  it('schräger Bezug: Abstand bleibt senkrecht zur Bezugslinie', () => {
    const g = refGuide({ x: 0, y: 0 }, { x: 3, y: -4 }, 'par', { x: 10, y: 10 }, 1);
    expect(pointLineDistance({ x: 0, y: 0 }, seg(g)).d).toBeCloseTo(1);
    expect(pointLineDistance({ x: 3, y: -4 }, seg(g)).d).toBeCloseTo(1);
  });
  it('ohne Abstand: durch den angetippten Punkt', () => {
    expect(refGuide(A, B, 'par', { x: 2, y: 7 }, null)).toMatchObject({ x: 2, y: 7 });
    expect(refGuide(A, B, 'perp', { x: 2, y: 7 }, null).angle).toBeCloseTo(90);
  });
});
