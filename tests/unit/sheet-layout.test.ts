import { describe, expect, it } from 'vitest';
import { defaultPaper, exportPaper, layoutSheet, MM, planHeading } from '../../src/lib/sheet-layout';
import type { PaperFormat, Plan, Rect } from '../../src/lib/types';

const inside = (r: Rect, box: Rect, eps = 0.01) =>
  r.x >= box.x - eps && r.y >= box.y - eps && r.x + r.w <= box.x + box.w + eps && r.y + r.h <= box.y + box.h + eps;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const SIZES: Record<PaperFormat, [number, number]> = { 'A4-hoch': [210, 297], 'A4-quer': [297, 210], 'A3-hoch': [297, 420], 'A3-quer': [420, 297] };

describe('Blattlayout A4/A3', () => {
  for (const paper of Object.keys(SIZES) as PaperFormat[]) {
    for (const region of [
      { w: 1190, h: 842 }, // A3 quer
      { w: 595, h: 842 }, // hoch
      { w: 5000, h: 400 }, // sehr breit
      { w: 300, h: 4000 }, // sehr hoch
    ]) {
      it(`${paper}: Plan ${region.w}×${region.h} proportional, zentriert, mit Rand`, () => {
        const L = layoutSheet(paper, region);
        const [wMm, hMm] = SIZES[paper];
        expect(L.w).toBeCloseTo(wMm * MM, 3); // Format bleibt genau A4/A3
        expect(L.h).toBeCloseTo(hMm * MM, 3);
        const print: Rect = { x: 10 * MM, y: 10 * MM, w: L.w - 20 * MM, h: L.h - 20 * MM };
        expect(inside(L.plan, print)).toBe(true); // mindestens 1 cm Rand
        expect(L.plan.y).toBeGreaterThanOrEqual(L.header.y + L.header.h - 0.01); // nicht unter der Überschrift
        expect(L.plan.w / L.plan.h).toBeCloseTo(region.w / region.h, 6); // nicht verzerrt
        // passt an mindestens einer Seite genau (größtmöglich), mittig auf der anderen
        const C = { x: 10 * MM, y: L.header.y + L.header.h, w: L.w - 20 * MM, h: L.h - 20 * MM - L.header.h };
        const fillsW = Math.abs(L.plan.w - C.w) < 0.01;
        const fillsH = Math.abs(L.plan.h - C.h) < 0.01;
        expect(fillsW || fillsH).toBe(true);
        expect(L.plan.x - C.x).toBeCloseTo(C.x + C.w - (L.plan.x + L.plan.w), 6);
        expect(L.plan.y - C.y).toBeCloseTo(C.y + C.h - (L.plan.y + L.plan.h), 6);
      });
    }
  }
});

describe('Übersicht platzsparend', () => {
  const C = (L: ReturnType<typeof layoutSheet>) => ({ x: 10 * MM, y: L.header.y + L.header.h, w: L.w - 20 * MM, h: L.h - 20 * MM - L.header.h });

  it('nutzt freien Platz: Plan bleibt gleich groß (hoher Ausschnitt auf A4 quer)', () => {
    const region = { w: 400, h: 600 };
    const plain = layoutSheet('A4-quer', region);
    const L = layoutSheet('A4-quer', region, { overview: { aspect: 1.414, corner: 'tr' } });
    expect(L.u).toBeCloseTo(plain.u, 9);
    expect(L.overview).not.toBeNull();
    expect(overlap(L.overview!, L.plan)).toBe(false);
    expect(inside(L.overview!, C(L))).toBe(true);
    expect(L.overview!.x).toBeGreaterThan(L.plan.x + L.plan.w); // rechts oben
    expect(L.overview!.y).toBeCloseTo(C(L).y, 6);
  });

  it('ohne freien Platz: Plan nur leicht verkleinert, keine leere Spalte', () => {
    // Ausschnitt mit genau dem Seitenverhältnis des Druckbereichs
    const base = layoutSheet('A4-quer', { w: 1, h: 1 });
    const c = C(base);
    const region = { w: c.w, h: c.h };
    const L = layoutSheet('A4-quer', region, { overview: { aspect: 1.414, corner: 'br' } });
    const plain = layoutSheet('A4-quer', region);
    expect(L.u).toBeLessThan(plain.u);
    expect(L.u).toBeGreaterThan(plain.u * 0.7);
    expect(overlap(L.overview!, L.plan)).toBe(false);
    expect(inside(L.overview!, C(L))).toBe(true);
    expect(inside(L.plan, C(L))).toBe(true);
    // Übersicht deutlich kleiner als der Plan (ergänzendes Element)
    expect(L.overview!.w * L.overview!.h).toBeLessThan(L.plan.w * L.plan.h * 0.15);
  });

  it('breiter Ausschnitt: Übersicht oben/unten im freien Streifen', () => {
    const region = { w: 3000, h: 800 };
    const plain = layoutSheet('A4-hoch', region);
    const L = layoutSheet('A4-hoch', region, { overview: { aspect: 0.7, corner: 'bl' } });
    expect(L.u).toBeCloseTo(plain.u, 9);
    expect(L.overview!.y).toBeGreaterThan(L.plan.y + L.plan.h); // unterhalb
    expect(L.overview!.x).toBeCloseTo(10 * MM, 6); // links
    expect(overlap(L.overview!, L.plan)).toBe(false);
  });
});

describe('Format und Überschrift', () => {
  const plan = (p: Partial<Plan>) => ({ pageWidth: 1000, pageHeight: 700, crop: null, planNumber: '12', planName: 'UG', ...p }) as Plan;
  it('Standard A4 passend zur Ausrichtung, gewähltes Format bleibt', () => {
    expect(defaultPaper({ w: 3, h: 2 })).toBe('A4-quer');
    expect(defaultPaper({ w: 2, h: 3 })).toBe('A4-hoch');
    expect(exportPaper(plan({}))).toBe('A4-quer');
    expect(exportPaper(plan({ crop: { x: 0, y: 0, w: 100, h: 500 } }))).toBe('A4-hoch');
    expect(exportPaper(plan({ paper: 'A3-quer', crop: { x: 0, y: 0, w: 100, h: 500 } }))).toBe('A3-quer');
    expect(exportPaper(plan({ paper: 'A3-quer', drawing: { unit: 'm', unitsPerMeter: 100, paper: 'A4-hoch', scale: 50 } }))).toBe('A4-hoch');
  });
  it('Überschrift: „Plannummer <Nr.> | <Titel>“, Titel Standard „Aufmaßplan“', () => {
    expect(planHeading(plan({}))).toBe('Plannummer 12 | Aufmaßplan');
    expect(planHeading(plan({ title: '  Bestandsaufnahme ' }))).toBe('Plannummer 12 | Bestandsaufnahme');
    expect(planHeading(plan({ title: '', planNumber: '067' }))).toBe('Plannummer 067 | Aufmaßplan');
    expect(planHeading(plan({ planNumber: '' }))).toBe('Aufmaßplan');
  });
});
