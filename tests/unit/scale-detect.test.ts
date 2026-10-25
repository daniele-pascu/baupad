import { describe, expect, it } from 'vitest';
import { detectScale, findScaleNotes, PT_PER_M, scaleFromDimensions, type PageText } from '../../src/lib/scale-detect';

const T = (str: string, x: number, y: number, angle = 0, width = str.length * 5): PageText => ({ str, x, y, angle, width, height: 8 });
const page = { x: 0, y: 0, w: 1191, h: 842 };

/** Maßkette: Maßzahlen mittig über ihren Strecken (Maßstab 1:n), waagrecht bzw. senkrecht */
function chain(values: string[], n: number, start = 100, at = 500, vertical = false, toM = (s: string) => Number(s.replace(',', '.'))): PageText[] {
  const k = PT_PER_M / n;
  let pos = start;
  return values.map((v) => {
    const len = toM(v) * k;
    const c = pos + len / 2;
    pos += len;
    return vertical ? T(v, at, c, -90) : T(v, c, at);
  });
}

describe('Maßstab automatisch erkennen', () => {
  it('Maßstabsangabe „M 1:100“ im Ausschnitt', () => {
    const items = [T('Plan A-101 – Untergeschoss', 800, 800), T('M 1:100', 1000, 800), T('Datum 25.10.2026', 200, 800)];
    expect(findScaleNotes(items, page)).toEqual([expect.objectContaining({ n: 100, labeled: true })]);
    const d = detectScale(items, page)!;
    expect(d.source).toBe('scale');
    expect(d.label).toBe('1:100');
    expect(d.unitsPerMeter).toBeCloseTo(PT_PER_M / 100, 6);
    // Kalibrierstrecke passt zum Maßstab
    expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / d.meters).toBeCloseTo(d.unitsPerMeter, 6);
    // außerhalb des Ausschnitts: nichts
    expect(detectScale(items, { x: 0, y: 0, w: 500, h: 500 })).toBeNull();
  });

  it('Uhrzeiten, Datumsangaben und Verhältnisse ohne Maßstab werden ignoriert', () => {
    expect(findScaleNotes([T('Besprechung 11:30', 100, 100), T('Gefälle 1:3', 100, 200), T('2:1', 100, 300)], page)).toEqual([]);
  });

  it('Maßkette in Metern (waagrecht) → 1:50', () => {
    const items = chain(['5,00', '3,65', '2,40', '4,10', '1,25'], 50);
    const r = scaleFromDimensions(items, page)!;
    expect(PT_PER_M / r.k).toBeCloseTo(50, 3);
    const d = detectScale(items, page)!;
    expect(d).toMatchObject({ source: 'dims', label: '1:50' });
    expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / d.meters).toBeCloseTo(d.unitsPerMeter, 3);
  });

  it('senkrechte Maßkette in Zentimetern → 1:100', () => {
    const items = chain(['500', '365', '240', '410'], 100, 80, 300, true, (s) => Number(s) / 100);
    expect(detectScale(items, page)).toMatchObject({ source: 'dims', label: '1:100' });
  });

  it('Angabe und Maßketten passen → exakte Angabe; widersprechen sie sich → Maßketten mit Hinweis', () => {
    const ok = [...chain(['5,00', '3,65', '2,40', '4,10'], 100), T('M 1:100', 1000, 800)];
    expect(detectScale(ok, page)).toMatchObject({ source: 'scale+dims', label: '1:100' });
    // Plan verkleinert gedruckt: Angabe 1:50, Maßketten ergeben 1:100
    const shrunk = [...chain(['5,00', '3,65', '2,40', '4,10'], 100), T('M 1:50', 1000, 800)];
    const d = detectScale(shrunk, page)!;
    expect(d.source).toBe('dims');
    expect(d.label).toBe('1:100');
    expect(d.warning).toMatch(/1:50/);
  });

  it('nicht eindeutig: zwei verschiedene Maßstäbe ohne Maßketten, oder zufällige Zahlen → nichts', () => {
    expect(detectScale([T('Grundriss M 1:100', 300, 800), T('Detail M 1:20', 900, 800)], page)).toBeNull();
    expect(detectScale([T('12', 100, 100), T('7', 160, 100), T('103', 200, 100), T('5,5', 290, 100)], page)).toBeNull();
  });
});
