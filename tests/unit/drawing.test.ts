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

describe('Linie: Maß eingeben – der richtige Punkt wandert', async () => {
  const { lineWithMeasures, attachedAt, applyMeasures, lineEnds } = await import('../../src/lib/drawing');
  const { lineShape, shapeArea } = await import('../../src/lib/geometry');
  const A = { x: 1, y: 1 };
  const B = { x: 4, y: 5 }; // Länge 5
  const line = lineShape(A, B);
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-4);

  it('A bleibt (Standard), B wird verlängert', () => {
    const [a, b] = lineEnds(lineWithMeasures(line, { length: 10 }, 0));
    near(a, A);
    near(b, { x: 1 + 6, y: 1 + 8 });
  });
  it('B bleibt, A wandert – Richtung A→B unverändert', () => {
    const [a, b] = lineEnds(lineWithMeasures(line, { length: 10 }, 1));
    near(b, B);
    near(a, { x: 4 - 6, y: 5 - 8 });
  });
  it('applyMeasures: Punkt B fest, wenn verlangt', () => {
    const [a, b] = lineEnds(applyMeasures({ type: 'line', shape: line }, { length: 2.5 }, { fixedEnd: 1 }));
    near(b, B);
    near(a, { x: 4 - 1.5, y: 5 - 2 });
  });
  it('angesetzt: Punkt auf einer anderen Linie bzw. in einer Wand', () => {
    const wand = { type: 'wall' as const, shape: lineShape({ x: 0, y: 5 }, { x: 10, y: 5 }), wall: { thickness: 0.3 } };
    expect(attachedAt(B, [wand])).toBe(true);
    expect(attachedAt({ x: 4, y: 5.14 }, [wand])).toBe(true); // in der Wand (halbe Stärke)
    expect(attachedAt(A, [wand])).toBe(false);
    const andere = { type: 'line' as const, shape: lineShape({ x: 1, y: 0 }, { x: 1, y: 3 }) };
    expect(attachedAt(A, [andere])).toBe(true);
    expect(attachedAt(A, [{ type: 'text' as const, shape: { type: 'rect' as const, x: 0, y: 0, w: 3, h: 3 } }])).toBe(false);
  });
  it('Fläche einer Form (kleinere Form hat beim Antippen Vorrang)', () => {
    expect(shapeArea({ type: 'rect', x: 0, y: 0, w: 2, h: 3 })).toBe(6);
    expect(shapeArea(line)).toBe(0);
    expect(shapeArea({ type: 'ellipse', x: 0, y: 0, w: 2, h: 2 })).toBeCloseTo(Math.PI, 9);
  });
});

describe('Textfeld: Absätze, feste Breite, Größe', async () => {
  const { wrapText, textLines, textFontSize, textBoxHeight, textBoxWidth, textShape, fitTextResize, refitText, keepTip, calloutTip, ROOM_LINE } = await import('../../src/lib/drawing');
  it('Absätze an Zeilenumbrüchen; ohne feste Breite kein Umbruch', () => {
    expect(wrapText('Eins\nZwei drei')).toEqual(['Eins', 'Zwei drei']);
    expect(wrapText('Eins\n\nDrei')).toEqual(['Eins', '', 'Drei']);
  });
  it('feste Breite: Umbruch an Wortgrenzen, überlange Wörter werden getrennt', () => {
    // 0,56 je Zeichen → 5,6 Schrifthöhen = 10 Zeichen je Zeile
    expect(wrapText('Riss prüfen und melden', 5.6)).toEqual(['Riss', 'prüfen und', 'melden']);
    expect(wrapText('Abdichtungsbahn', 5.6)).toEqual(['Abdichtung', 'sbahn']);
  });
  it('einzeiliger Text wie bisher: Höhe = Schrifthöhe', () => {
    const s = textShape({ x: 1, y: 1 }, 'Hallo', 0.2);
    expect(s.h).toBe(0.2);
    expect(textFontSize({ text: 'Hallo' }, s.h)).toBe(0.2);
  });
  it('zwei Absätze: Höhe wächst um den Zeilenabstand, Breite = längste Zeile, Schrifthöhe bleibt', () => {
    const s = textShape({ x: 1, y: 1 }, 'Kurz\nEine lange Zeile', 0.2);
    expect(s.h).toBeCloseTo(0.2 * (1 + ROOM_LINE), 6);
    expect(s.w).toBeCloseTo(16 * 0.2 * 0.56, 6);
    expect(textFontSize({ text: 'Kurz\nEine lange Zeile' }, s.h)).toBeCloseTo(0.2, 9);
    expect(s.y).toBeCloseTo(0.9, 9); // erste Zeile mittig auf der angetippten Stelle
  });
  const e = { text: 'Riss prüfen und melden', shape: textShape({ x: 2, y: 2 }, 'Riss prüfen und melden', 0.2), font: undefined };
  it('Seite gezogen: feste Breite, Text bricht um, Schrift bleibt, oben links bleibt', () => {
    const r = fitTextResize(e, { ...e.shape, w: 1.12 }); // 5,6 Schrifthöhen
    expect(r.wrap).toBeCloseTo(5.6, 6);
    const next = { ...e, wrap: r.wrap, shape: r.shape };
    expect(textLines(next)).toEqual(['Riss', 'prüfen und', 'melden']);
    expect(textFontSize(next, r.shape.h)).toBeCloseTo(0.2, 6);
    expect([r.shape.x, r.shape.y, r.shape.w]).toEqual([e.shape.x, e.shape.y, 1.12]);
    // linke Seite gezogen: die rechte Kante bleibt
    const l = fitTextResize(e, { ...e.shape, x: e.shape.x + (e.shape.w - 1.12), w: 1.12 });
    expect(l.shape.x + l.shape.w).toBeCloseTo(e.shape.x + e.shape.w, 6);
  });
  it('Ecke gezogen: alles gleichmäßig – Schrift doppelt so groß, Umbruch unverändert', () => {
    const w = fitTextResize(e, { ...e.shape, w: 1.12 });
    const boxed = { ...e, wrap: w.wrap, shape: w.shape };
    const r = fitTextResize(boxed, { ...boxed.shape, w: boxed.shape.w * 2, h: boxed.shape.h * 2 });
    const next = { ...boxed, shape: r.shape };
    expect(textFontSize(next, r.shape.h)).toBeCloseTo(0.4, 6);
    expect(textLines(next)).toEqual(['Riss', 'prüfen und', 'melden']);
    expect(r.shape.w).toBeCloseTo(2.24, 6);
  });
  it('Text geändert bzw. Schriftgröße: Rahmen folgt, feste Breite bleibt', () => {
    const boxed = { ...e, wrap: 5.6, shape: { ...e.shape, w: 1.12, h: textBoxHeight({ text: e.text, wrap: 5.6 }, 0.2) } };
    const longer = refitText(boxed, { ...boxed, text: `${e.text} bis Freitag` });
    expect(longer.w).toBe(1.12);
    expect(longer.h).toBeGreaterThan(boxed.shape.h);
    const bigger = refitText(boxed, boxed, 0.3);
    expect(textFontSize(boxed, bigger.h)).toBeCloseTo(0.3, 6);
    expect(bigger.w).toBeCloseTo(textBoxWidth(boxed, bigger.h), 9);
  });
  it('Text mit Pfeil: Rahmen wächst – die Spitze bleibt auf dem Plan', () => {
    const c = { ...e, leader: { dx: -1.5, dy: 1 } };
    const tip = calloutTip(c.shape, c.leader);
    const next = refitText(c, { ...c, text: 'Riss\nprüfen\nund melden' });
    const kept = keepTip(c, next).leader!;
    const tip2 = calloutTip(next, kept);
    expect(Math.hypot(tip2.x - tip.x, tip2.y - tip.y)).toBeLessThan(2e-4);
  });
});

describe('Schriftgröße bezogen auf das Blatt', async () => {
  const { sheetUnitsPerPt, printSheetRect, aufmassPaper, PAPER, PRINT_MARGIN_MM } = await import('../../src/lib/drawing');
  it('Bereich füllt das Blatt: 10 pt sind 10 pt auf dem Papier, egal wie groß der Bereich in m ist', () => {
    const avail = PAPER['A3-quer'].w - 2 * PRINT_MARGIN_MM; // mm
    for (const w of [30, 4200]) {
      const region = { w, h: w * 0.5 };
      const u = sheetUnitsPerPt(region, 'A3-quer');
      // 10 pt = 3,53 mm; Anteil an der Blattbreite ist immer gleich
      expect((10 * u) / w).toBeCloseTo(3.52778 / avail, 6);
    }
  });
  it('kleines Detail im Aufmaß: das Blatt ist die eingepasste Zeichnung, nicht der Zeichenmaßstab', () => {
    const plan = { pageWidth: 4200, pageHeight: 2970, drawing: { scale: 100, paper: 'A3-quer' as const } } as never;
    const sheet = printSheetRect(plan, [{ shape: { type: 'rect', x: 10, y: 10, w: 0.3, h: 0.2 } }], [])!;
    const u = sheetUnitsPerPt(sheet, aufmassPaper(plan, sheet));
    // Zeichenblatt 1:100: 1 pt = 3,53 Einheiten (cm); eingepasstes Detail: viel weniger
    expect(u).toBeLessThan(0.2);
  });
});

describe('Schriftgrad: Schritte und Rundung', async () => {
  const { nextSize, roundPt } = await import('../../src/lib/text-font');
  it('größer: 10–16 in 1er-, bis 24 in 2er-, darüber in 4er-Schritten', () => {
    const seq = [10];
    while (seq[seq.length - 1] < 40) seq.push(nextSize(seq[seq.length - 1], 1));
    expect(seq).toEqual([10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40]);
  });
  it('kleiner: dieselben Stufen zurück, unter 10 in halben Punkten', () => {
    const seq = [32];
    while (seq[seq.length - 1] > 8.5) seq.push(nextSize(seq[seq.length - 1], -1));
    expect(seq).toEqual([32, 28, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9.5, 9, 8.5]);
  });
  it('Zwischenwerte rasten auf die nächste Stufe ein', () => {
    expect(nextSize(25.5, 1)).toBe(28);
    expect(nextSize(27, -1)).toBe(24);
    expect(nextSize(17, 1)).toBe(18);
    expect(nextSize(17, -1)).toBe(16);
    expect(nextSize(9.5, 1)).toBe(10);
  });
  it('ab 10 pt keine Kommastellen, darunter halbe Punkte', () => {
    expect(roundPt(12.4)).toBe(12);
    expect(roundPt(17.6)).toBe(18);
    expect(roundPt(8.3)).toBe(8.5);
    expect(roundPt(9.8)).toBe(10);
  });
});

describe('Hinweislinie wie im Detailplan: Text auf einer Linie, von deren Ende zum Ziel', async () => {
  const { calloutGeometry } = await import('../../src/lib/drawing');
  const box = { x: 10, y: 10, w: 6, h: 1 };
  it('Linie unter dem Text in Textbreite; vom näheren Ende gerade zur Spitze', () => {
    for (const end of ['arrow', 'dot', 'none'] as const) {
      const g = calloutGeometry(box, { x: 2, y: 15 }, 0.5, end);
      expect(g.line).toHaveLength(3);
      const [tip, near, far] = g.line;
      expect(tip).toEqual({ x: 2, y: 15 });
      // Linie unter dem Text: knapp unter der Schrift, von der linken bis zur rechten Textkante
      expect(near.y).toBeCloseTo(11.09, 9);
      expect(far.y).toBeCloseTo(near.y, 9);
      expect([near.x, far.x]).toEqual([10, 16]);
      expect(!!g.head).toBe(end === 'arrow');
      expect(!!g.dot).toBe(end === 'dot');
    }
    // Spitze rechts vom Text: Hinweislinie vom rechten Ende
    const r = calloutGeometry(box, { x: 30, y: 20 }, 0.5).line;
    expect([r[1].x, r[2].x]).toEqual([16, 10]);
  });
  it('Spitze über dem Text: die Linie wird kurz verlängert, damit sie nicht durch die Schrift läuft', () => {
    const g = calloutGeometry(box, { x: 12, y: 4 }, 0.5);
    expect(g.line).toHaveLength(4);
    const [tip, out, near] = g.line;
    expect(tip).toEqual({ x: 12, y: 4 });
    expect(out.y).toBeCloseTo(near.y, 9); // waagrecht
    expect(near.x - out.x).toBeCloseTo(0.4, 9); // kurz: 0,8 × Maß
    // Spitze schräg links darunter: keine Verlängerung
    expect(calloutGeometry(box, { x: 5, y: 16 }, 0.5).line).toHaveLength(3);
  });
});

describe('Bruchlinie: Zickzack und ausgeblendete Seite', async () => {
  const { breakPath, breakMask, defaultBreakSide, inDrawOrder, hiddenByBreak } = await import('../../src/lib/drawing');
  const { lineShape } = await import('../../src/lib/geometry');
  // senkrechte Linie von oben nach unten bei x = 10
  const line = lineShape({ x: 10, y: 0 }, { x: 10, y: 20 });
  it('Linienzug mit Zickzack in der Mitte, Enden bleiben', () => {
    const p = breakPath(line);
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual({ x: 10, y: 0 });
    expect(p[5]).toEqual({ x: 10, y: 20 });
    // Ausschlag zu beiden Seiten um die Mitte
    expect(p[2].x).not.toBeCloseTo(10, 3);
    expect(p[2].x - 10).toBeCloseTo(-(p[3].x - 10), 9);
    expect((p[2].y + p[3].y) / 2).toBeCloseTo(10, 9);
  });
  it('blendet den Streifen dahinter aus – so weit, wie dort Zeichnung liegt', () => {
    // Zeichnung von x = 2 bis 30 (reicht über die Linie hinaus nach links und rechts)
    const boxes = [{ x: 2, y: 5, w: 28, h: 6 }];
    // in Zeichenrichtung (nach unten) links = Bildschirm rechts (x > 10)
    const right = breakMask(line, 1, boxes)!;
    expect(Math.max(...right.map((p) => p.x))).toBeGreaterThanOrEqual(30);
    expect(Math.min(...right.map((p) => p.x))).toBeCloseTo(10, 9);
    const left = breakMask(line, -1, boxes)!;
    expect(Math.min(...left.map((p) => p.x))).toBeLessThanOrEqual(2);
    expect(Math.max(...left.map((p) => p.x))).toBeCloseTo(10, 9);
    // nur in der Länge der Linie
    expect([Math.min(...left.map((p) => p.y)), Math.max(...left.map((p) => p.y))]).toEqual([0, 20]);
    // nichts dahinter bzw. Zeichnung neben dem Streifen: keine Fläche
    expect(breakMask(line, -1, [{ x: 12, y: 5, w: 5, h: 5 }])).toBeNull();
    expect(breakMask(line, 1, [{ x: 12, y: 30, w: 5, h: 5 }])).toBeNull();
  });
  it('Vorgabe: ausgeblendet wird die Seite mit weniger Zeichnung', () => {
    // Zeichnung liegt überwiegend rechts (x > 10) → links ausblenden (-1)
    expect(defaultBreakSide(line, [{ x: 8, y: 2, w: 30, h: 10 }])).toBe(-1);
    expect(defaultBreakSide(line, [{ x: -20, y: 2, w: 32, h: 10 }])).toBe(1);
  });
  it('Zeichenreihenfolge: Zeichnung, dann Bruchlinien, darüber Texte und Maße', () => {
    const list = [{ type: 'text' as const, n: 1 }, { type: 'break' as const, n: 2 }, { type: 'rect' as const, n: 3 }, { type: 'dimension' as const, n: 4 }, { type: 'wall' as const, n: 5 }];
    expect(inDrawOrder(list).map((e) => e.n)).toEqual([3, 5, 2, 1, 4]);
    expect(list.filter(hiddenByBreak).map((e) => e.n)).toEqual([3, 5]);
  });
});
