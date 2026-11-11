import { describe, expect, it } from 'vitest';
import { boundarySegments, regionAt } from '../../src/lib/regions';
import type { Point } from '../../src/lib/geometry';

const seg = (ax: number, ay: number, bx: number, by: number): [Point, Point] => [
  { x: ax, y: ay },
  { x: bx, y: by },
];

describe('Raumerkennung aus Einzelkanten', () => {
  it('Rechteck aus vier einzelnen Linien', () => {
    const r = regionAt({ x: 2, y: 1 }, [seg(0, 0, 4, 0), seg(4, 0, 4, 3), seg(4, 3, 0, 3), seg(0, 3, 0, 0)]);
    expect(r?.area).toBeCloseTo(12, 6);
  });
  it('überstehende Linien und T-Stöße: Raum wird an den Schnittpunkten erkannt', () => {
    const segs = [seg(-1, 0, 6, 0), seg(0, -1, 0, 4), seg(-1, 3, 6, 3), seg(5, -1, 5, 4), seg(2, 0, 2, 3)];
    expect(regionAt({ x: 1, y: 1 }, segs)?.area).toBeCloseTo(6, 6);
    expect(regionAt({ x: 4, y: 2 }, segs)?.area).toBeCloseTo(9, 6);
  });
  it('offener Bereich → null', () => {
    expect(regionAt({ x: 2, y: 1 }, [seg(0, 0, 4, 0), seg(4, 0, 4, 3), seg(4, 3, 0, 3)])).toBeNull();
  });
  it('Stichlinie im Raum ändert die Fläche nicht', () => {
    const r = regionAt({ x: 3, y: 2 }, [seg(0, 0, 4, 0), seg(4, 0, 4, 3), seg(4, 3, 0, 3), seg(0, 3, 0, 0), seg(0, 1, 1.5, 1)]);
    expect(r?.area).toBeCloseTo(12, 6);
  });
  it('Insel im Raum: Strahl trifft zuerst die Insel, Raum wird trotzdem gefunden', () => {
    const r = regionAt({ x: 1, y: 1.5 }, [seg(0, 0, 6, 0), seg(6, 0, 6, 3), seg(6, 3, 0, 3), seg(0, 3, 0, 0), seg(2, 1, 3, 1), seg(3, 1, 3, 2), seg(3, 2, 2, 2), seg(2, 2, 2, 1)]);
    expect(r?.area).toBeCloseTo(18, 6);
  });
  it('Wände ohne geschlossene Achse: lichte Fläche zwischen vier einzelnen Wänden (25 cm, Achsmaß 5 × 4 m)', () => {
    const wall = (ax: number, ay: number, bx: number, by: number) => ({ type: 'wall' as const, wall: { thickness: 0.25 }, shape: { type: 'line' as const, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), points: [[ax <= bx ? 0 : 1, ay <= by ? 0 : 1], [ax <= bx ? 1 : 0, ay <= by ? 1 : 0]] as [number, number][] } });
    const segs = boundarySegments([wall(-0.125, 0, 5.125, 0), wall(5, -0.125, 5, 4.125), wall(5.125, 4, -0.125, 4), wall(0, 4.125, 0, -0.125)]);
    expect(regionAt({ x: 2.5, y: 2 }, segs)?.area).toBeCloseTo(4.75 * 3.75, 4);
  });
});
