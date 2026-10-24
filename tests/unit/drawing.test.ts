import { describe, expect, it } from 'vitest';
import {
  annotationsOf,
  applyMeasures,
  circleFromMeasures,
  contentRegion,
  drawingRegion,
  gridStep,
  lineAngle,
  lineEnds,
  lineFromMeasures,
  lineLength,
  measuresOf,
  nearestSnap,
  printScale,
  rectFromMeasures,
  shapeToMeters,
  shapeToPage,
  snapAngle,
  snapPoints,
  snapToGrid,
  suggestMeasures,
  triangleFromMeasures,
} from '../../src/lib/drawing';
import { fromShapeLocal, shapeAABB } from '../../src/lib/geometry';
import type { DrawElement, Shape } from '../../src/lib/types';

const el = (type: DrawElement['type'], shape: Shape) => ({ id: type, type, shape });

describe('Maßsystem: reale Maße in Metern', () => {
  it('Rechteck 5,00 × 3,65 m wird exakt gespeichert', () => {
    const s = rectFromMeasures({ x: 1, y: 2 }, 5, 3.65);
    expect(s).toMatchObject({ type: 'rect', x: 1, y: 2, w: 5, h: 3.65 });
    expect(measuresOf(el('rect', s))).toEqual({ length: 5, width: 3.65, rotation: 0 });
  });

  it('Umrechnung in Seitenkoordinaten (1 cm) und zurück ist verlustfrei', () => {
    const s = rectFromMeasures({ x: 1.25, y: 0.5 }, 5, 3.65);
    const page = shapeToPage(s);
    expect(page).toMatchObject({ x: 125, y: 50, w: 500, h: 365 });
    expect(shapeToMeters(page)).toMatchObject({ x: 1.25, y: 0.5, w: 5, h: 3.65 });
  });

  it('Linie mit Länge und Richtung', () => {
    const s = lineFromMeasures({ x: 0, y: 0 }, 4.2, 90);
    expect(lineLength(s)).toBeCloseTo(4.2, 9);
    expect(lineAngle(s)).toBe(90);
    const [a, b] = lineEnds(s);
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b.y).toBeCloseTo(4.2, 9);
    const diag = lineFromMeasures({ x: 1, y: 1 }, 2, 225);
    expect(lineLength(diag)).toBeCloseTo(2, 3);
    expect(lineAngle(diag)).toBeCloseTo(225, 1);
  });

  it('Kreis über Durchmesser, Dreieck über Grundseite und Höhe', () => {
    const c = circleFromMeasures({ x: 3, y: 3 }, 2);
    expect(c).toMatchObject({ x: 2, y: 2, w: 2, h: 2 });
    expect(measuresOf(el('ellipse', c))).toEqual({ diameter: 2 });
    const t = triangleFromMeasures({ x: 0, y: 0 }, 4, 3, 'left');
    expect(measuresOf(el('triangle', t))).toEqual({ base: 4, height: 3, rotation: 0 });
    expect(t.points![0]).toEqual([0, 0]); // rechtwinklig: Spitze über der linken Ecke
  });
});

describe('Maß ändern aktualisiert die Zeichnung, Bezugspunkt bleibt fest', () => {
  it('Rechteck: linke obere Ecke bleibt', () => {
    const s = rectFromMeasures({ x: 1, y: 1 }, 5, 3.65);
    const n = applyMeasures({ type: 'rect', shape: s }, { length: 6.2 });
    expect(n).toMatchObject({ x: 1, y: 1, w: 6.2, h: 3.65 });
  });

  it('Gedrehtes Rechteck: Ecke bleibt auch bei Drehung an ihrer Stelle', () => {
    const s: Shape = { ...rectFromMeasures({ x: 2, y: 2 }, 4, 2), rotation: 30 };
    const corner = fromShapeLocal(s, { x: s.x, y: s.y });
    const n = applyMeasures({ type: 'rect', shape: s }, { length: 7, width: 1 });
    const corner2 = fromShapeLocal(n, { x: n.x, y: n.y });
    expect(corner2.x).toBeCloseTo(corner.x, 3);
    expect(corner2.y).toBeCloseTo(corner.y, 3);
    expect(n.w).toBe(7);
    expect(n.h).toBe(1);
    expect(n.rotation).toBe(30);
  });

  it('Linie: Startpunkt bleibt, neue Länge und Richtung', () => {
    const s = lineFromMeasures({ x: 1, y: 2 }, 3, 0);
    const n = applyMeasures({ type: 'line', shape: s }, { length: 5.5 });
    expect(lineEnds(n)[0]).toEqual({ x: 1, y: 2 });
    expect(lineLength(n)).toBeCloseTo(5.5, 9);
    const m = applyMeasures({ type: 'line', shape: n }, { angle: 270 });
    expect(lineLength(m)).toBeCloseTo(5.5, 9);
    expect(lineEnds(m)[1].y).toBeCloseTo(2 - 5.5, 9);
  });

  it('Kreis: Mittelpunkt bleibt', () => {
    const c = circleFromMeasures({ x: 5, y: 5 }, 2);
    const n = applyMeasures({ type: 'ellipse', shape: c }, { diameter: 3 });
    expect(n).toMatchObject({ x: 3.5, y: 3.5, w: 3, h: 3 });
  });

  it('Dreieck: linke untere Ecke bleibt', () => {
    const t = triangleFromMeasures({ x: 0, y: 0 }, 4, 3);
    const n = applyMeasures({ type: 'triangle', shape: t }, { height: 5 });
    expect(n.x).toBe(0);
    expect(n.y + n.h).toBe(3); // Grundlinie unverändert
    expect(n.h).toBe(5);
  });
});

describe('Raster, Fangpunkte und Winkel', () => {
  it('Rasterweite passt sich dem Zoom an (Bildschirm ≠ Maßstab)', () => {
    expect(gridStep(5)).toBe(5); // stark herausgezoomt
    expect(gridStep(40)).toBe(0.5);
    expect(gridStep(200)).toBe(0.1);
    expect(gridStep(2000)).toBe(0.01);
  });

  it('Einrasten am Raster', () => {
    expect(snapToGrid({ x: 1.234, y: 3.66 }, 0.05)).toEqual({ x: 1.25, y: 3.65 });
  });

  it('Fangpunkte: Ecken und Kantenmitten eines Rechtecks, Linienenden', () => {
    const pts = snapPoints([el('rect', rectFromMeasures({ x: 0, y: 0 }, 5, 3.65)), el('line', lineFromMeasures({ x: 10, y: 0 }, 2, 0))]);
    expect(pts).toEqual(expect.arrayContaining([{ x: 5, y: 3.65 }, { x: 2.5, y: 0 }, { x: 12, y: 0 }]));
    expect(nearestSnap({ x: 5.03, y: 3.6 }, pts, 0.1)).toEqual({ x: 5, y: 3.65 });
    expect(nearestSnap({ x: 7, y: 7 }, pts, 0.1)).toBeNull();
  });

  it('Winkel rastet auf 15°-Schritte ein, wenn nahe daran', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 0.3 });
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.x).toBeCloseTo(Math.hypot(10, 0.3), 9);
    expect(snapAngle({ x: 0, y: 0 }, { x: 10, y: 3.6 })).toEqual({ x: 10, y: 3.6 }); // ≈ 19,8° – kein Einrasten
  });
});

describe('Bemaßung und Planbereich', () => {
  it('Rechteck zeigt Länge und Breite, Kreis den Durchmesser', () => {
    const r = annotationsOf({ type: 'rect', shape: rectFromMeasures({ x: 0, y: 0 }, 5, 3.65) });
    expect(r.dims.map((d) => d.text)).toEqual(['5,00 m', '3,65 m']);
    const c = annotationsOf({ type: 'ellipse', shape: circleFromMeasures({ x: 0, y: 0 }, 2) });
    expect(c.labels[0].text).toBe('Ø 2,00 m');
    const off = annotationsOf({ type: 'rect', shape: rectFromMeasures({ x: 0, y: 0 }, 5, 3.65), showDims: false });
    expect(off.dims).toHaveLength(0);
  });

  it('Planbereich wächst mit dem Inhalt', () => {
    const plan = { pageWidth: 2000, pageHeight: 1400 };
    expect(drawingRegion(plan, [])).toEqual({ x: 0, y: 0, w: 2000, h: 1400 });
    const r = drawingRegion(plan, [{ shape: rectFromMeasures({ x: 18, y: -2 }, 5, 3) }]);
    expect(r.x).toBe(0);
    expect(r.y).toBe(-300); // -2 m und 1 m Rand
    expect(r.w).toBe(2400); // bis 23 m + 1 m Rand
  });

  it('Druckbereich: nur der Inhalt mit 1 m Rand', () => {
    const plan = { pageWidth: 2000, pageHeight: 1400 };
    expect(contentRegion(plan, [])).toEqual({ x: 0, y: 0, w: 2000, h: 1400 });
    expect(contentRegion(plan, [{ shape: rectFromMeasures({ x: 5, y: 4 }, 5, 3.65) }])).toEqual({ x: 400, y: 300, w: 700, h: 565 });
  });

  it('Maßvorschlag für Markierungen auf gezeichneten Plänen', () => {
    expect(suggestMeasures({ type: 'rect', x: 100, y: 100, w: 240, h: 150 })).toEqual({ length: 2.4, width: 1.5 });
    expect(suggestMeasures(shapeToPage(lineFromMeasures({ x: 0, y: 0 }, 3.5, 0)))).toEqual({ length: 3.5, width: null });
  });

  it('Druckmaßstab passend zur Papiergröße', () => {
    expect(printScale({ w: 20, h: 14 }, { w: 400, h: 270 })).toBe(75);
    expect(printScale({ w: 5, h: 3 }, { w: 400, h: 270 })).toBe(20);
  });

  it('AABB in Seitenkoordinaten', () => {
    expect(shapeAABB(shapeToPage(rectFromMeasures({ x: 1, y: 1 }, 2, 1)))).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });
});
