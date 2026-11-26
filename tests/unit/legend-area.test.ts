import { describe, expect, it } from 'vitest';
import { areaBesideLegend, layoutSheet } from '../../src/lib/sheet-layout';

const C = { x: 30, y: 60, w: 780, h: 500 };
const hits = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const planIn = (box: typeof C, region: { w: number; h: number }) => {
  const u = Math.min(box.w / region.w, box.h / region.h);
  return { x: box.x + (box.w - region.w * u) / 2, y: box.y + (box.h - region.h * u) / 2, w: region.w * u, h: region.h * u };
};

describe('Legende verdeckt nie den Plan', () => {
  const legend = { x: 650, y: 60, w: 160, h: 80 }; // oben rechts
  it('Plan füllt den Druckbereich: er rückt neben die Legende – in der Richtung, in der er größer bleibt', () => {
    for (const region of [{ w: 780, h: 500 }, { w: 300, h: 500 }, { w: 780, h: 200 }, { w: 1000, h: 900 }]) {
      const area = areaBesideLegend(C, region, legend);
      expect(hits(planIn(area, region), legend), JSON.stringify(region)).toBe(false);
    }
    // breiter Plan: Streifen oben (Plan behält die Breite); hoher Plan: Streifen seitlich
    expect(areaBesideLegend(C, { w: 780, h: 400 }, legend).w).toBe(C.w);
    expect(areaBesideLegend(C, { w: 600, h: 500 }, legend).h).toBe(C.h);
  });
  it('genug freier Rand neben dem Plan: nichts ändert sich', () => {
    expect(areaBesideLegend(C, { w: 300, h: 500 }, { x: 700, y: 60, w: 110, h: 80 })).toEqual(C);
  });
  it('Blatt mit Legende: Plan kleiner als ohne, aber frei', () => {
    const region = { w: 400, h: 280 };
    const a = layoutSheet('A4-quer', region);
    const lg = { x: a.w - 200, y: a.header.y + a.header.h, w: 180, h: 90 };
    const b = layoutSheet('A4-quer', region, { legend: lg });
    expect(b.u).toBeLessThan(a.u);
    expect(hits(b.plan, lg)).toBe(false);
  });
});
