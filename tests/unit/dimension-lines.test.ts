import { describe, expect, it } from 'vitest';
import { analyzeDimensions, calibrationLine, matchDimensionLines, parseDimText } from '../../src/lib/dimension-lines';
import { pathSegments, type PlanSeg } from '../../src/lib/pdf-snap';
import { PT_PER_M, type PageText } from '../../src/lib/scale-detect';

describe('Maßtext lesen', () => {
  it('Zahl und mögliche Einheiten', () => {
    expect(parseDimText('5,00')).toMatchObject({ value: 5, units: ['m'] });
    expect(parseDimText('515,5')).toMatchObject({ value: 515.5, units: ['cm'] }); // 515,5 cm = 5,155 m
    expect(parseDimText('515⁵')).toMatchObject({ value: 515.5, units: ['cm'] }); // hochgestellte mm
    expect(parseDimText('365')).toMatchObject({ value: 365, units: ['cm', 'mm'] });
    expect(parseDimText('5,155 m')).toMatchObject({ value: 5.155, units: ['m'] });
    expect(parseDimText('5155 mm')).toMatchObject({ value: 5155, units: ['mm'] });
    expect(parseDimText('2,5')).toMatchObject({ units: ['cm', 'm'] });
  });
  it('keine Maße: Text, Datum, Maßstab, Fläche', () => {
    for (const s of ['Raum 101', '25.10.2026', '1:50', '12,50 m²', 'A-101', '']) expect(parseDimText(s)).toBeNull();
  });
});

// Plan 1:50: Maßkette in cm mit Schrägstrichen, Linie als ein Strich; dazu Störzahlen
const K = PT_PER_M / 50;
const Y = 500; // Maßlinie (Seitenkoordinaten, y nach unten)
const T = (str: string, x: number, y: number, angle = 0): PageText => ({ str, x, y, angle, width: str.length * 5, height: 8 });
function plan(values: number[], unitToM = 0.01) {
  const segs: PlanSeg[] = [];
  let x = 100;
  const xs = [x];
  for (const v of values) xs.push((x += v * unitToM * K));
  pathSegments([0, xs[0], Y, 1, xs[xs.length - 1], Y], [1, 0, 0, 1, 0, 0], 0, segs, null); // eine durchgehende Linie
  xs.forEach((p, i) => pathSegments([0, p - 3, Y + 3, 1, p + 3, Y - 3], [1, 0, 0, 1, 0, 0], i + 1, segs, null)); // Schrägstriche
  pathSegments([0, 100, 300, 1, 900, 300], [1, 0, 0, 1, 0, 0], 99, segs, null); // Wand ohne Maß
  const texts = values.map((v, i) => T(String(v).replace('.', ','), (xs[i] + xs[i + 1]) / 2, Y - 7));
  return { segs, texts: [...texts, T('101', 400, 290), T('12,50 m²', 500, 320)], xs };
}

describe('Maßlinien zuordnen und Maßstab bestimmen', () => {
  it('Kette in cm (515,5 · 365 · 240): jedes Maß auf seinem Linienstück, Einheit cm, 1:50', () => {
    const { segs, texts, xs } = plan([515.5, 365, 240]);
    const m = matchDimensionLines(texts, segs, null);
    expect(m.map((x) => x.text)).toEqual(['515,5', '365', '240']); // Raumnummer und Fläche ohne Maßlinie → kein Maß
    expect(m[0].a.x).toBeCloseTo(xs[0], 6);
    expect(m[0].b.x).toBeCloseTo(xs[1], 6); // an den Schrägstrichen geteilt
    const a = analyzeDimensions(m);
    expect(a.unit).toBe('cm');
    expect(PT_PER_M / a.k!).toBeCloseTo(50, 6);
    expect(a.okCount).toBe(3);
    expect(a.rows[0].meters).toBeCloseTo(5.155, 9);
    expect(a.rows[0].measured).toBeCloseTo(5.155, 6);
    const c = calibrationLine(a)!;
    expect(Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) / c.meters).toBeCloseTo(K, 4);
    expect(c.count).toBe(3);
  });
  it('widersprüchliches Maß wird gekennzeichnet und nicht verwendet', () => {
    const { segs, texts } = plan([500, 365, 240, 410]);
    texts[1] = { ...texts[1], str: '380' }; // falsch beschriftet
    const a = analyzeDimensions(matchDimensionLines(texts, segs, null));
    expect(a.okCount).toBe(3);
    expect(a.rows.find((r) => r.match.text === '380')!.ok).toBe(false);
    expect(a.rows.find((r) => r.match.text === '380')!.deviation!).toBeLessThan(-0.03);
    expect(PT_PER_M / a.k!).toBeCloseTo(50, 6);
  });
  it('Einheit vorgeben: mm statt cm → anderer Maßstab (1:5)', () => {
    const { segs, texts } = plan([515.5, 365, 240]);
    const a = analyzeDimensions(matchDimensionLines(texts, segs, null), 'mm');
    expect(a.unit).toBe('mm');
    expect(a.okCount).toBe(2); // 515,5 hat Nachkommastelle – nicht als mm gelesen
    expect(PT_PER_M / a.k!).toBeCloseTo(5, 6);
  });
  it('nur ein Maß: kein Maßstab (keine Kontrolle möglich)', () => {
    const { segs, texts } = plan([515.5]);
    expect(analyzeDimensions(matchDimensionLines(texts, segs, null)).k).toBeNull();
  });
});
