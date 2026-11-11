import { describe, expect, it } from 'vitest';
import { fillRegion, printSheetRect, sheetFields } from '../../src/lib/drawing';

const rect = (x: number, y: number, w: number, h: number) => ({ shape: { type: 'rect' as const, x, y, w, h } });
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

describe('Blatt im Aufmaßplan: Zeichnung immer zentriert und blattfüllend (Maßstab wird nicht erzwungen)', () => {
  for (const [name, w, h] of [
    ['klein (5 × 3 m)', 5, 3],
    ['groß (80 × 20 m)', 80, 20],
    ['hoch (4 × 30 m)', 4, 30],
  ] as const) {
    it(`${name} auf A3 quer 1:100: Blatt passt genau um den Inhalt, zentriert`, () => {
      const plan = sheetFields('A3-quer', 100);
      const r = printSheetRect(plan, [rect(1, 1, w, h)], [])!;
      const c = fillRegion(plan, [rect(1, 1, w, h)]);
      expect(r.w / r.h).toBeCloseTo(plan.pageWidth / plan.pageHeight, 3); // Seitenverhältnis des Blatts
      near(r.x + r.w / 2, c.x + c.w / 2); // zentriert
      near(r.y + r.h / 2, c.y + c.h / 2);
      // füllt: an einer Seite genau so groß wie der Inhalt (mit kleinem Rand), sonst größer
      expect(Math.min(Math.abs(r.w - c.w), Math.abs(r.h - c.h))).toBeLessThan(0.01);
      expect(r.w).toBeGreaterThanOrEqual(c.w - 0.01);
      expect(r.h).toBeGreaterThanOrEqual(c.h - 0.01);
    });
  }
  it('kleiner Rand um den Inhalt (4 % der größeren Seite, mind. 10 cm)', () => {
    const plan = sheetFields('A4-hoch', 50);
    const c = fillRegion(plan, [rect(2, 2, 10, 4)]); // 10 m → 40 cm Rand
    near(c.x, 160);
    near(c.w, 1080);
  });
  it('ohne Papierformat (ältere Pläne): A3 passend zur Zeichnung', () => {
    const r = printSheetRect({ pageWidth: 2000, pageHeight: 1400 }, [rect(0, 0, 10, 30)], [])!;
    expect(r.h).toBeGreaterThan(r.w); // hoch
  });
});
