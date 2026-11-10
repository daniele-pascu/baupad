import { describe, expect, it } from 'vitest';
import { printSheetRect, sheetFields } from '../../src/lib/drawing';

const rect = (x: number, y: number, w: number, h: number) => ({ shape: { type: 'rect' as const, x, y, w, h } });
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

describe('Blatt im Aufmaß (Plan messen) wie im PDF', () => {
  it('Inhalt auf dem Blatt: genau das Zeichenblatt im gewählten Maßstab', () => {
    const plan = sheetFields('A3-quer', 100);
    const r = printSheetRect(plan, [rect(1, 1, 5, 3)], [])!;
    near(r.x, 0);
    near(r.y, 0);
    near(r.w, plan.pageWidth);
    near(r.h, plan.pageHeight);
  });
  it('Inhalt größer als das Blatt: Blatt passend vergrößert (kleinerer Maßstab), Inhalt zentriert', () => {
    const plan = sheetFields('A3-quer', 100);
    const r = printSheetRect(plan, [rect(0, 0, 80, 20)], [])!; // 80 m breit – passt nicht auf A3 1:100 (40 m)
    expect(r.w).toBeGreaterThanOrEqual(80 * 100);
    expect(r.w / r.h).toBeCloseTo(plan.pageWidth / plan.pageHeight, 3); // Seitenverhältnis des Blatts bleibt
    near(r.x + r.w / 2, 40 * 100); // zentriert auf den Inhalt
  });
  it('ohne Maßstab: Inhalt füllt das Blatt, zentriert', () => {
    const plan = sheetFields('A4-hoch', 0);
    const r = printSheetRect(plan, [rect(2, 2, 4, 1)], [])!;
    expect(r.w / r.h).toBeCloseTo(plan.pageWidth / plan.pageHeight, 3);
    near(r.x + r.w / 2, 4 * 100);
    near(r.y + r.h / 2, 2.5 * 100);
  });
  it('ohne Papierformat (ältere Pläne): kein Blatt', () => {
    expect(printSheetRect({ pageWidth: 2000, pageHeight: 1400 }, [], [])).toBeNull();
  });
});
