import { round2 } from './numbers';
import { distanceToPolyline, fromShapeLocal, freehandPoints, lineShape, outlineParts, polygonArea, shapeAABB, shapeCenter, shapeVertices, toShapeLocal, type Point } from './geometry';
import { formatMeasure } from './numbers';
import type { Damage, DrawElement, DrawingInfo, Leader, LeaderEnd, PaperFormat, Plan, Rect, Shape, TextFont } from './types';
import { charWidthFactor } from './text-font';
import { symbolAnchor, symbolDef } from './symbols';

/**
 * Maßsystem selbst gezeichneter Pläne.
 *
 * - Zeichnungsobjekte speichern ihre Geometrie in Metern (DrawElement.shape).
 * - Die Planansicht arbeitet wie bei importierten Plänen in Seitenkoordinaten; bei gezeichneten
 *   Plänen entspricht eine Seiteneinheit 1 cm (unitsPerMeter = 100).
 * - Die Bildschirmdarstellung (Zoom, Verschieben, Fenstergröße) ist davon vollständig getrennt.
 */

export const UNITS_PER_M = 100;
export const DRAWING_INFO: DrawingInfo = { unit: 'm', unitsPerMeter: UNITS_PER_M };
/** Standardgröße der Zeichenfläche in m (wächst bei Bedarf mit dem Inhalt) */
export const DEFAULT_SHEET = { w: 20, h: 14 };

/** Papierformate (mm) für gezeichnete Pläne */
export const PAPER: Record<PaperFormat, { w: number; h: number; label: string }> = {
  'A4-hoch': { w: 210, h: 297, label: 'A4 Hochformat' },
  'A4-quer': { w: 297, h: 210, label: 'A4 Querformat' },
  'A3-hoch': { w: 297, h: 420, label: 'A3 Hochformat' },
  'A3-quer': { w: 420, h: 297, label: 'A3 Querformat' },
  'A2-hoch': { w: 420, h: 594, label: 'A2 Hochformat' },
  'A2-quer': { w: 594, h: 420, label: 'A2 Querformat' },
  'A1-hoch': { w: 594, h: 841, label: 'A1 Hochformat' },
  'A1-quer': { w: 841, h: 594, label: 'A1 Querformat' },
  'A0-hoch': { w: 841, h: 1189, label: 'A0 Hochformat' },
  'A0-quer': { w: 1189, h: 841, label: 'A0 Querformat' },
};
export const PAPER_FORMATS = Object.keys(PAPER) as PaperFormat[];
/** Format (A4 … A0) und Ausrichtung getrennt wählbar – gespeichert wird weiter „A3-quer“ usw. */
export const PAPER_SIZES = ['A4', 'A3', 'A2', 'A1', 'A0'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export type PaperOrient = 'hoch' | 'quer';
export const paperSize = (p: PaperFormat) => p.split('-')[0] as PaperSize;
export const paperOrient = (p: PaperFormat) => p.split('-')[1] as PaperOrient;
export const makePaper = (size: PaperSize, orient: PaperOrient) => `${size}-${orient}` as PaperFormat;
/** Übliche Maßstäbe 1:n */
export const SCALES = [20, 25, 50, 75, 100, 200, 250, 500, 1000];
/** Druckränder und Kopfzeile in mm – das Zeichenblatt ist der Bereich innerhalb davon */
export const PRINT_MARGIN_MM = 10;
export const PRINT_HEADER_MM = 14;

/** Zeichenblatt in realen Metern für Papierformat und Maßstab (bedruckbarer Bereich × Maßstab). */
export function sheetMeters(paper: PaperFormat, scale: number): { w: number; h: number } {
  const p = PAPER[paper];
  return {
    w: roundM(((p.w - 2 * PRINT_MARGIN_MM) / 1000) * scale),
    h: roundM(((p.h - 2 * PRINT_MARGIN_MM - PRINT_HEADER_MM) / 1000) * scale),
  };
}

/** Planfelder für ein Zeichenblatt (Maßsystem, Format, Maßstab, Blattgröße in Seiteneinheiten). */
/** scale 0 = ohne Maßstab (Blatt füllen, zentriert); das Zeichenblatt am Bildschirm entspricht dann 1:100 */
export function sheetFields(paper: PaperFormat, scale: number): Pick<Plan, 'drawing' | 'pageWidth' | 'pageHeight'> {
  const fit = scale === 0;
  const m = sheetMeters(paper, fit ? 100 : scale);
  return { drawing: { ...DRAWING_INFO, paper, scale: fit ? 100 : scale, ...(fit ? { fit: true } : {}) }, pageWidth: Math.round(m.w * UNITS_PER_M), pageHeight: Math.round(m.h * UNITS_PER_M) };
}

export const paperLabel = (d: Plan['drawing']) => (d?.paper ? `${PAPER[d.paper].label} · ${d.fit ? 'ohne Maßstab' : `1:${d.scale ?? 100}`}` : '');

export const isDrawingPlan = (p: Pick<Plan, 'source'> | null | undefined) => p?.source === 'drawing';

export const unitsPerMeter = (p: Pick<Plan, 'drawing'>) => p.drawing?.unitsPerMeter ?? UNITS_PER_M;

/** Form in Metern → Seitenkoordinaten (Punkte sind relativ und bleiben unverändert). */
export function shapeToPage(s: Shape, k = UNITS_PER_M): Shape {
  return { ...s, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
}

/** Form in Seitenkoordinaten → Meter. */
export function shapeToMeters(s: Shape, k = UNITS_PER_M): Shape {
  return { ...s, x: s.x / k, y: s.y / k, w: s.w / k, h: s.h / k };
}

/** Rundet auf 0,1 mm, damit eingegebene Maße exakt erhalten bleiben (keine Gleitkommareste). */
export const roundM = (n: number) => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------------------
// Objekte aus Maßen erzeugen

/** Rechteck mit Länge (waagerecht) × Breite (senkrecht), linke obere Ecke bei `at`. */
export function rectFromMeasures(at: Point, length: number, width: number): Shape {
  return { type: 'rect', x: roundM(at.x), y: roundM(at.y), w: roundM(length), h: roundM(width) };
}

/** Linie ab `start` mit Länge und Richtung (Grad, 0 = nach rechts, 90 = nach unten). */
export function lineFromMeasures(start: Point, length: number, angleDeg: number, type: 'line' = 'line'): Shape {
  const a = (angleDeg * Math.PI) / 180;
  const end = { x: roundM(start.x + length * Math.cos(a)), y: roundM(start.y + length * Math.sin(a)) };
  return { ...lineShape({ x: roundM(start.x), y: roundM(start.y) }, end), type };
}

/** Kreis mit Durchmesser um den Mittelpunkt. */
export function circleFromMeasures(center: Point, diameter: number): Shape {
  const r = diameter / 2;
  return { type: 'ellipse', x: roundM(center.x - r), y: roundM(center.y - r), w: roundM(diameter), h: roundM(diameter) };
}

export type Apex = 'left' | 'center' | 'right';
const APEX_X: Record<Apex, number> = { left: 0, center: 0.5, right: 1 };

/** Dreieck mit Grundseite × Höhe; linke obere Ecke des Rahmens bei `at`. Spitze links (rechtwinklig), mittig oder rechts. */
export function triangleFromMeasures(at: Point, base: number, height: number, apex: Apex = 'center'): Shape {
  return {
    type: 'triangle',
    x: roundM(at.x),
    y: roundM(at.y),
    w: roundM(base),
    h: roundM(height),
    points: [[APEX_X[apex], 0], [1, 1], [0, 1]],
  };
}

export function apexOf(s: Shape): Apex {
  const u = s.points?.[0]?.[0] ?? 0.5;
  return u < 0.25 ? 'left' : u > 0.75 ? 'right' : 'center';
}

/** Dreieck in Grundform (Spitze oben, Grundlinie unten) – dann über Grundseite und Höhe bemaßbar. */
export function isRegularTriangle(s: Shape): boolean {
  const p = s.points ?? [];
  return p.length === 3 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1 && p[2][0] === 0 && p[2][1] === 1;
}

/** Kontrollmaße einer Fläche aus ihren Eckpunkten (m bzw. m²): Seitenlängen, Umfang, Fläche. */
export function shapeInfo(e: Pick<DrawElement, 'type' | 'shape'>): { sides: number[]; perimeter: number; area: number | null } | null {
  const s = e.shape;
  if (e.type === 'rect') return { sides: [s.w, s.h, s.w, s.h], perimeter: 2 * (s.w + s.h), area: s.w * s.h };
  if (e.type === 'ellipse') return { sides: [], perimeter: Math.PI * (s.w + s.h) / 2, area: (Math.PI * s.w * s.h) / 4 };
  if (e.type !== 'triangle' && !(e.type === 'freehand' && s.closed !== false)) return null;
  const v = shapeVertices(s);
  const sides = v.map((a, i) => dist(a, v[(i + 1) % v.length]));
  return { sides, perimeter: sides.reduce((x, y) => x + y, 0), area: polygonArea(v) };
}

/** Endpunkte einer Linie bzw. Maßlinie (mit Drehung). */
export function lineEnds(s: Shape): [Point, Point] {
  const pts = freehandPoints(s).map((p) => fromShapeLocal(s, p));
  return [pts[0], pts[1] ?? pts[0]];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Länge einer Linie in m. */
export function lineLength(s: Shape): number {
  const [a, b] = lineEnds(s);
  return dist(a, b);
}

/** Richtung einer Linie in Grad (0 = nach rechts, 90 = nach unten), 0 … 360. */
export function lineAngle(s: Shape): number {
  const [a, b] = lineEnds(s);
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360 * 100) / 100;
}

/** Umfang bzw. Länge eines Freihandzugs in m. */
export function pathLength(s: Shape): number {
  const pts = freehandPoints(s);
  // Linien einzeln: Lücken zählen nicht
  const gaps = new Set(s.closed === false ? (s.breaks ?? []) : []);
  let l = 0;
  for (let i = 1; i < pts.length; i++) if (!gaps.has(i)) l += dist(pts[i - 1], pts[i]);
  if (s.closed !== false && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

// ---------------------------------------------------------------------------
// Maße lesen und ändern

/** Bearbeitbare Maße eines Objekts (alle in m bzw. Grad). */
export interface Measures {
  length?: number;
  width?: number;
  diameter?: number;
  base?: number;
  height?: number;
  angle?: number;
  rotation?: number;
  textHeight?: number;
}

export function measuresOf(e: Pick<DrawElement, 'type' | 'shape'> & Partial<Pick<DrawElement, 'text' | 'room'>>): Measures {
  const s = e.shape;
  const rotation = s.rotation ?? 0;
  switch (e.type) {
    case 'rect':
    case 'symbol':
      return { length: s.w, width: s.h, rotation };
    case 'line':
    case 'dimension':
      return { length: roundM(lineLength(s)), angle: lineAngle(s) };
    case 'ellipse':
      return Math.abs(s.w - s.h) < 1e-6 ? { diameter: s.w } : { length: s.w, width: s.h, rotation };
    case 'triangle':
      // Nach dem Verschieben einzelner Ecken: Seiten und Fläche nur zur Kontrolle (siehe shapeInfo)
      return isRegularTriangle(s) ? { base: s.w, height: s.h, rotation } : { rotation };
    case 'text':
      return { textHeight: roundM(textFontSize(e, s.h)), rotation };
    default:
      return { rotation };
  }
}

/**
 * Ändert die Maße eines Objekts. Ein Bezugspunkt bleibt dabei fest:
 * Rechteck/Text links oben, Dreieck links unten, Linie Startpunkt, Kreis Mittelpunkt.
 */
export function applyMeasures(
  e: Pick<DrawElement, 'type' | 'shape' | 'text' | 'font'> & Partial<Pick<DrawElement, 'symbol'>>,
  m: Measures,
  /** Linie: dieser Punkt bleibt liegen (0 = A, 1 = B), der andere wandert */
  opts: { fixedEnd?: 0 | 1 } = {},
): Shape {
  const s = e.shape;
  switch (e.type) {
    case 'symbol': {
      // Tür & Co.: nur gleichmäßig – Breite und Tiefe gekoppelt, Bezugspunkt (Öffnungslinie, Anschlag) bleibt
      const anchor = symbolAnchor(e.symbol);
      if (anchor && s.w > 0 && s.h > 0) {
        const f = m.length !== undefined && Math.abs(m.length - s.w) > 1e-9 ? m.length / s.w : m.width !== undefined ? m.width / s.h : 1;
        return withRotation(resizeKeeping(s, s.w * f, s.h * f, anchor), m.rotation);
      }
      return withRotation(resizeKeeping(s, m.length ?? s.w, m.width ?? s.h, { x: 0, y: 0 }), m.rotation);
    }
    case 'rect':
      return withRotation(resizeKeeping(s, m.length ?? s.w, m.width ?? s.h, { x: 0, y: 0 }), m.rotation);
    case 'triangle':
      return withRotation(resizeKeeping(s, m.base ?? s.w, m.height ?? s.h, { x: 0, y: 1 }), m.rotation);
    case 'ellipse': {
      if (m.diameter !== undefined) {
        const c = shapeCenter(s);
        return { ...circleFromMeasures(c, m.diameter), rotation: s.rotation };
      }
      return withRotation(resizeKeeping(s, m.length ?? s.w, m.width ?? s.h, { x: 0.5, y: 0.5 }), m.rotation);
    }
    case 'line':
      return lineWithMeasures(s, m, opts.fixedEnd ?? 0);
    case 'dimension': {
      const [a] = lineEnds(s);
      return lineFromMeasures(a, m.length ?? lineLength(s), m.angle ?? lineAngle(s), 'line');
    }
    case 'text': {
      const h = m.textHeight !== undefined ? textBoxHeight(e, m.textHeight) : s.h;
      const w = textBoxWidth(e, h, e.font);
      return withRotation(resizeKeeping(s, w, h, { x: 0, y: 0 }), m.rotation);
    }
    default:
      return withRotation(s, m.rotation);
  }
}

/**
 * Linie mit neuer Länge bzw. neuem Winkel (Winkel immer von A nach B): Punkt `fixed` bleibt liegen, der andere wandert.
 */
export function lineWithMeasures(s: Shape, m: Measures, fixed: 0 | 1): Shape {
  const [a, b] = lineEnds(s);
  const len = m.length ?? lineLength(s);
  const ang = m.angle ?? lineAngle(s);
  if (fixed === 0) return lineFromMeasures(a, len, ang, 'line');
  const r = (ang * Math.PI) / 180;
  const end = { x: roundM(b.x), y: roundM(b.y) };
  return lineShape({ x: roundM(end.x - len * Math.cos(r)), y: roundM(end.y - len * Math.sin(r)) }, end);
}

/**
 * Ist der Punkt an ein anderes Objekt angesetzt – liegt er auf dessen Umriss bzw. Eckpunkt (Wand: in der Wand)?
 * Meter; Texte und Maßlinien zählen nicht.
 */
export function attachedAt(p: Point, others: Pick<DrawElement, 'type' | 'shape' | 'wall'>[], tol = 0.005): boolean {
  return others.some((o) => {
    if (o.type === 'text' || o.type === 'dimension') return false;
    const reach = tol + (o.type === 'wall' ? (o.wall?.thickness ?? 0) / 2 : 0);
    const b = shapeAABB(o.shape);
    if (p.x < b.x - reach || p.x > b.x + b.w + reach || p.y < b.y - reach || p.y > b.y + b.h + reach) return false;
    return outlineParts(o.shape).some((part) =>
      part.length > 1 ? distanceToPolyline(p, part, false) <= reach : Math.hypot(p.x - part[0].x, p.y - part[0].y) <= reach,
    );
  });
}

function withRotation(s: Shape, rotation: number | undefined): Shape {
  if (rotation === undefined) return s;
  const r = ((rotation % 360) + 360) % 360;
  return { ...s, rotation: r || undefined };
}

/**
 * Neue Größe w × h; der Punkt `anchor` (relativ 0..1 im Rahmen) behält seine Lage – auch
 * bei gedrehten Objekten.
 */
export function resizeKeeping(s: Shape, w: number, h: number, anchor: Point): Shape {
  const before = fromShapeLocal(s, { x: s.x + anchor.x * s.w, y: s.y + anchor.y * s.h });
  const next: Shape = { ...s, w: roundM(w), h: roundM(h) };
  const after = fromShapeLocal(next, { x: next.x + anchor.x * next.w, y: next.y + anchor.y * next.h });
  return { ...next, x: roundM(next.x + before.x - after.x), y: roundM(next.y + before.y - after.y) };
}

/** Geschätzte Textbreite in m bei Schrifthöhe h (je nach Schriftart, fett etwas breiter). */
export function textWidth(text: string, h: number, font?: TextFont): number {
  return roundM(Math.max(1, text.length) * h * charWidthFactor(font));
}

/** Raumstempel: Zeilenabstand in Schrifthöhen */
export const ROOM_LINE = 1.35;
/** Angaben eines Textobjekts, aus denen sich seine Zeilen ergeben */
type TextLike = { text?: string; room?: { area: number | null; note?: string }; wrap?: number; font?: TextFont };

/**
 * Text in Zeilen: Absätze an den Zeilenumbrüchen; mit `wrapEm` (Breite in Schrifthöhen) bricht jede Zeile an
 * Wortgrenzen um – gerechnet mit der geschätzten Zeichenbreite, damit Ansicht und PDF gleich umbrechen.
 */
export function wrapText(text: string, wrapEm?: number, font?: TextFont): string[] {
  const paras = text.split('\n');
  if (!wrapEm || !(wrapEm > 0)) return paras;
  const max = Math.max(1, Math.floor(wrapEm / charWidthFactor(font) + 1e-6));
  const out: string[] = [];
  for (const para of paras) {
    let line = '';
    for (let word of para.split(' ')) {
      // überlanges Wort: hart trennen
      while (word.length > max) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Zeilen eines Textobjekts (Raumstempel: Name, Fläche, Zusatz; Text: Absätze, mit fester Breite umbrochen) */
export function textLines(e: TextLike): string[] {
  if (!e.room) return wrapText(e.text ?? '', e.wrap, e.font);
  return [e.text ?? '', e.room.area === null ? '– m²' : `${formatMeasure(roundM(e.room.area))} m²`, ...(e.room.note ? [e.room.note] : [])];
}
/** Schrifthöhe eines Textobjekts mit Gesamthöhe h */
export function textFontSize(e: TextLike, h: number): number {
  const n = textLines(e).length;
  return h / (1 + (n - 1) * ROOM_LINE);
}
/** Gesamthöhe aus Schrifthöhe */
export const textBoxHeight = (e: TextLike, fs: number) => roundM(fs * (1 + (textLines(e).length - 1) * ROOM_LINE));
/** Breite eines Textobjekts mit Gesamthöhe h (längste Zeile bzw. die feste Breite des Textfelds) */
export function textBoxWidth(e: TextLike, h: number, font?: TextFont): number {
  const fs = textFontSize(e, h);
  if (e.wrap && !e.room) return roundM(e.wrap * fs);
  // Raumstempel: Name fett
  return Math.max(...textLines(e).map((l, i) => textWidth(l, fs, e.room && i === 0 ? { ...font, bold: true } : font)));
}

/** Rahmen eines neuen Textes: Schrifthöhe h, die erste Zeile liegt mittig auf der angetippten Stelle */
export function textShape(at: Point, text: string, h: number, font?: TextFont): Shape {
  const e = { text, font };
  const total = textBoxHeight(e, h);
  return { type: 'rect', x: roundM(at.x), y: roundM(at.y - h / 2), w: textBoxWidth(e, total, font), h: total };
}

/**
 * Text, Schrift oder Schriftgröße geändert: Rahmen neu (Zeilenzahl und Breite folgen), die linke obere Ecke bleibt –
 * beim Raumstempel die Mitte. `fs` = neue Schrifthöhe (fehlt: wie bisher).
 */
export function refitText(e: Pick<DrawElement, 'shape' | 'text' | 'font'> & Partial<Pick<DrawElement, 'room' | 'wrap'>>, next: TextLike, fs = textFontSize(e, e.shape.h)): Shape {
  const h = textBoxHeight(next, fs);
  const w = textBoxWidth(next, h, next.font);
  return { ...e.shape, w, h, ...(e.room ? { x: roundM(e.shape.x + (e.shape.w - w) / 2) } : {}) };
}

/** Text mit Pfeil: Rahmen geändert – die Pfeilspitze bleibt auf dem Plan, wo sie war */
export function keepTip(e: Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>, next: Shape): { leader?: Leader } {
  return e.leader ? { leader: { ...e.leader, ...leaderFor(next, calloutTip(e.shape, e.leader)) } } : {};
}

/** schmalstes Textfeld: Breite in Schrifthöhen */
export const TEXT_MIN_WRAP = 2;

/**
 * Textfeld mit der Maus bzw. dem Finger geändert (`raw` = neuer Rahmen aus dem Anfasser):
 * - nur die Breite geändert (Seitenanfasser): feste Breite – der Text bricht neu um, die Höhe folgt, Schrift bleibt
 * - Höhe geändert (Ecke): alles wird gleichmäßig größer bzw. kleiner, auch die Schrift
 * - sonst (verschoben, gedreht): unverändert übernommen
 */
export function fitTextResize(e: Pick<DrawElement, 'shape' | 'text' | 'font'> & Partial<Pick<DrawElement, 'room' | 'wrap'>>, raw: Shape): { shape: Shape; wrap?: number } {
  const s0 = e.shape;
  const eps = 1e-6;
  const dw = Math.abs(raw.w - s0.w);
  const dh = Math.abs(raw.h - s0.h);
  if (e.room || (dw < eps && dh < eps)) return { shape: raw, wrap: e.wrap };
  if (dh < eps) {
    const fs = textFontSize(e, s0.h);
    const wrap = Math.round(Math.max(TEXT_MIN_WRAP, raw.w / fs) * 1000) / 1000;
    const next = { ...e, wrap };
    const h = textBoxHeight(next, fs);
    const w = roundM(wrap * fs);
    // linke Kante gezogen: die rechte bleibt stehen
    const leftMoved = Math.abs(raw.x - s0.x) > eps;
    return { shape: { ...raw, x: roundM(leftMoved ? raw.x + raw.w - w : raw.x), y: s0.y, w, h }, wrap };
  }
  // gleichmäßig: Breite folgt der Schrifthöhe (Mitte bleibt)
  const w = textBoxWidth(e, raw.h, e.font);
  return { shape: { ...raw, x: roundM(raw.x + (raw.w - w) / 2), w }, wrap: e.wrap };
}

// ---------------------------------------------------------------------------
// Text mit Pfeil

/** Bezugslinie eines Textes im Bezugssystem des Textes (nicht gedreht): Linienzug Spitze → Knick → Text und ihr Ende. */
export interface CalloutGeometry {
  /** Spitze, Knick, Ansatz am Text */
  line: Point[];
  /** gefüllte Pfeilspitze (Spitze, links, rechts) – nur beim Ende „Pfeil“ */
  head: [Point, Point, Point] | null;
  /** gefüllter Punkt an der Spitze – nur beim Ende „Punkt“ */
  dot: { c: Point; r: number } | null;
  /** Strichstärke in derselben Einheit */
  width: number;
}

/**
 * Bezugslinie zum Text: kurzer waagrechter Anschluss an der näheren Seite (links bzw. rechts mittig), dann schräg zur
 * Spitze. `size` (wie `box`, z. B. die Schrifthöhe beim Einfügen) bestimmt Pfeilspitze, Punkt, Anschluss und
 * Strichstärke – unabhängig von der jetzigen Schrift- bzw. Rahmengröße. Alles im Bezugssystem des Textes (ungedreht).
 */
export function calloutGeometry(box: Rect, tip: Point, size: number, end: LeaderEnd = 'arrow'): CalloutGeometry {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const left = tip.x < cx;
  const gap = size * 0.25;
  const attach = { x: left ? box.x - gap : box.x + box.w + gap, y: cy };
  const land = Math.min(size * 0.8, Math.max(0, left ? attach.x - tip.x : tip.x - attach.x));
  const knee = { x: attach.x + (left ? -land : land), y: cy };
  const from = Math.hypot(tip.x - knee.x, tip.y - knee.y) > 1e-9 ? knee : attach;
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / d;
  const uy = (tip.y - from.y) / d;
  const L = end === 'arrow' ? Math.min(size * 0.7, d * 0.6) : 0;
  const W = L * 0.34;
  const base = { x: tip.x - ux * L, y: tip.y - uy * L };
  return {
    line: [tip, base, ...(from === knee ? [knee] : []), attach].filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-9),
    head: end === 'arrow' ? [tip, { x: base.x - uy * W, y: base.y + ux * W }, { x: base.x + uy * W, y: base.y - ux * W }] : null,
    dot: end === 'dot' ? { c: tip, r: size * 0.16 } : null,
    width: size * 0.09,
  };
}

/** Maß der Bezugslinie in m: beim Einfügen gemerkt, sonst (ältere Texte) die jetzige Schrifthöhe */
export const leaderSize = (e: Pick<DrawElement, 'shape' | 'text'> & Partial<Pick<DrawElement, 'leader' | 'wrap' | 'font' | 'room'>>) => e.leader?.size ?? textFontSize(e, e.shape.h);

/** Pfeilspitze eines Textes in Plankoordinaten (wie `s`; `scale` = Einheiten je m, z. B. k für Seitenkoordinaten). */
export function calloutTip(s: Shape, leader: { dx: number; dy: number }, scale = 1): Point {
  const c = shapeCenter(s);
  return fromShapeLocal(s, { x: c.x + leader.dx * scale, y: c.y + leader.dy * scale });
}

/** Pfeilspitze (Plankoordinaten wie `s`) → gespeicherter Versatz zur Textmitte in m. */
export function leaderFor(s: Shape, tip: Point, scale = 1): { dx: number; dy: number } {
  const c = shapeCenter(s);
  const l = toShapeLocal(s, tip);
  return { dx: roundM((l.x - c.x) / scale), dy: roundM((l.y - c.y) / scale) };
}

/**
 * Text mit Bezugslinie in Plankoordinaten (gedreht wie der Text) – für Ansicht, Antippen und PDF. `s` = Rahmen in
 * diesen Koordinaten, `scale` = Einheiten je m, `sizeM` = Maß der Linie in m (siehe leaderSize).
 */
export function calloutWorld(s: Shape, leader: Leader, scale: number, sizeM: number): CalloutGeometry {
  const c = shapeCenter(s);
  const g = calloutGeometry({ x: s.x, y: s.y, w: s.w, h: s.h }, { x: c.x + leader.dx * scale, y: c.y + leader.dy * scale }, sizeM * scale, leader.end);
  const R = (p: Point) => fromShapeLocal(s, p);
  return { line: g.line.map(R), head: g.head ? (g.head.map(R) as [Point, Point, Point]) : null, dot: g.dot ? { c: R(g.dot.c), r: g.dot.r } : null, width: g.width };
}

// ---------------------------------------------------------------------------
// Raster und Einrasten

/** Rasterweiten in m – stark vergrößert bis 0,0001 m (Zehntelmillimeter, so genau wird gespeichert) */
const GRID_STEPS = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100];

/** Rasterweite in m, sodass benachbarte Linien mindestens `minPx` Bildschirmpixel auseinanderliegen. */
export function gridStep(pxPerMeter: number, minPx = 14): number {
  return GRID_STEPS.find((s) => s * pxPerMeter >= minPx) ?? GRID_STEPS[GRID_STEPS.length - 1];
}

/** Nächstgrößere Rasterweite (Hauptlinien). */
export function majorStep(step: number): number {
  const i = GRID_STEPS.indexOf(step);
  return GRID_STEPS[Math.min(GRID_STEPS.length - 1, i + 1)];
}

export const snapToGrid = (p: Point, step: number): Point => ({ x: roundM(Math.round(p.x / step) * step), y: roundM(Math.round(p.y / step) * step) });

/** Fangpunkte (Eckpunkte, Endpunkte, Mittelpunkte) aller Objekte in m. */
export function snapPoints(elements: Pick<DrawElement, 'id' | 'type' | 'shape'>[], exceptId?: string): Point[] {
  const out: Point[] = [];
  for (const e of elements) {
    if (e.id === exceptId || e.type === 'text') continue;
    const s = e.shape;
    if (e.type === 'line' || e.type === 'dimension') {
      const [a, b] = lineEnds(s);
      out.push(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (e.type === 'triangle' || e.type === 'freehand') {
      out.push(...freehandPoints(s).map((p) => fromShapeLocal(s, p)));
    } else if (e.type === 'ellipse') {
      const c = shapeCenter(s);
      out.push(c, ...[{ x: s.x + s.w / 2, y: s.y }, { x: s.x + s.w, y: s.y + s.h / 2 }, { x: s.x + s.w / 2, y: s.y + s.h }, { x: s.x, y: s.y + s.h / 2 }].map((p) => fromShapeLocal(s, p)));
    } else {
      const corners = [
        { x: s.x, y: s.y },
        { x: s.x + s.w, y: s.y },
        { x: s.x + s.w, y: s.y + s.h },
        { x: s.x, y: s.y + s.h },
      ].map((p) => fromShapeLocal(s, p));
      out.push(...corners);
      for (let i = 0; i < 4; i++) out.push({ x: (corners[i].x + corners[(i + 1) % 4].x) / 2, y: (corners[i].y + corners[(i + 1) % 4].y) / 2 });
    }
  }
  return out;
}

/** Nächster Fangpunkt innerhalb der Toleranz (m) oder null. */
export function nearestSnap(p: Point, candidates: Point[], tol: number): Point | null {
  let best: Point | null = null;
  let bestD = tol;
  for (const c of candidates) {
    const d = dist(p, c);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Richtung von `from` nach `to` auf Vielfache von `stepDeg` einrasten, wenn sie nahe daran liegt. */
export function snapAngle(from: Point, to: Point, stepDeg = 15, tolDeg = 4): Point {
  const len = dist(from, to);
  if (len < 1e-9) return to;
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const snapped = Math.round(deg / stepDeg) * stepDeg;
  if (Math.abs(snapped - deg) > tolDeg) return to;
  const a = (snapped * Math.PI) / 180;
  return { x: from.x + len * Math.cos(a), y: from.y + len * Math.sin(a) };
}

// ---------------------------------------------------------------------------
// Bemaßung

/** Maßkette zwischen a und b (m); `side` = Seite der Maßlinie (+1 / −1 relativ zur Normalen). */
export interface DimAnnotation {
  a: Point;
  b: Point;
  side: 1 | -1;
  text: string;
  /** true: Text direkt an der Linie, ohne Hilfslinien (z. B. Linienlänge) */
  inline?: boolean;
  /** Maßlinie (Werkzeug „Maß“): passt die Maßzahl nicht dazwischen, steht sie daneben mit Führungslinie */
  leader?: boolean;
}

/**
 * Maßzahl einer zu kurzen Maßlinie a2–b2 wie im CAD daneben setzen: Führungslinie vom Maß schräg nach oben,
 * Unterstrich unter der Zahl (gleiche Einheit wie die Eingaben: Bildschirmpixel bzw. Punkt). null = passt dazwischen.
 */
export function dimLeader(a2: Point, b2: Point, textW: number, fs: number): { path: Point[]; center: Point; angle: number } | null {
  const len = Math.hypot(b2.x - a2.x, b2.y - a2.y);
  if (textW + fs * 0.8 <= len) return null;
  let angle = (Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const r = (angle * Math.PI) / 180;
  const d = { x: Math.cos(r), y: Math.sin(r) };
  const up = { x: Math.sin(r), y: -Math.cos(r) };
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
  // Ende in Leserichtung „rechts“
  const right = (b2.x - a2.x) * d.x + (b2.y - a2.y) * d.y >= 0 ? b2 : a2;
  const start = { x: mid.x + (right.x - mid.x) * 0.6, y: mid.y + (right.y - mid.y) * 0.6 };
  const elbow = { x: start.x + up.x * fs * 1.6 + d.x * fs * 0.9, y: start.y + up.y * fs * 1.6 + d.y * fs * 0.9 };
  const w = textW + fs * 0.4;
  const end = { x: elbow.x + d.x * w, y: elbow.y + d.y * w };
  const center = { x: elbow.x + d.x * (w / 2) + up.x * fs * 0.65, y: elbow.y + d.y * (w / 2) + up.y * fs * 0.65 };
  return { path: [start, elbow, end], center, angle };
}

/**
 * Freistehende Beschriftung (z. B. „Ø 2,00 m“). Optional gedreht (`angle` in Grad, wie im Plan), mehrzeilig
 * (`lines` nebeneinander quer zur Leserichtung) und mit Bündigkeit; `pad` = Abstand vom Bezugspunkt in Schrifthöhen
 * (entlang der Leserichtung, bei `anchor` 'middle' quer dazu: negativ = darüber).
 */
export interface DimLabel {
  at: Point;
  text: string;
  angle?: number;
  anchor?: 'start' | 'middle' | 'end';
  lines?: string[];
  pad?: number;
}

const cm = (m: number) => String(Math.round(m * 100));

/**
 * Fenster nach ÖNORM A 6240: Breite und Höhe in cm, um 90° gedreht nebeneinander unter dem Fenster (z. B. 130 | 150),
 * die Rohbauparapethöhe „RPH 90“ darüber. Ohne eingegebene Höhe steht nur die Breite.
 */
export function windowLabels(e: Pick<DrawElement, 'type' | 'shape' | 'showDims' | 'symbol' | 'opening'>): DimLabel[] {
  if (e.type !== 'symbol' || e.showDims === false || symbolDef(e.symbol?.id)?.group !== 'window') return [];
  const s = e.shape;
  const rot = s.rotation ?? 0;
  const L = (p: Point) => fromShapeLocal(s, p);
  const bottom = L({ x: s.x + s.w / 2, y: s.y + s.h });
  const top = L({ x: s.x + s.w / 2, y: s.y });
  const h = e.opening?.height;
  const lines = [cm(s.w), ...(h ? [cm(h)] : [])];
  // Leserichtung vom Fenster weg nach außen gedreht (aufwärts lesbar); nie auf dem Kopf
  let angle = rot - 90;
  let anchor: DimLabel['anchor'] = 'end';
  const norm = ((angle % 360) + 360) % 360;
  // auf dem Kopf (zwischen 90° und 270°) → um 180° drehen; senkrecht lesbar (aufwärts bzw. abwärts) bleibt
  if (norm > 90 && norm < 270) {
    angle -= 180;
    anchor = 'start';
  }
  const out: DimLabel[] = [{ at: bottom, text: lines.join('/'), angle, anchor, lines: anchor === 'start' ? [...lines].reverse() : lines, pad: 0.4 }];
  const sill = e.opening?.sill;
  if (sill !== null && sill !== undefined) {
    let a2 = rot;
    const n2 = ((a2 % 360) + 360) % 360;
    const flip = n2 > 90 && n2 < 270;
    if (flip) a2 -= 180;
    // über dem Fenster (Seite gegenüber der Breite/Höhe); gedrehter Text bleibt lesbar, Abstand nach außen
    out.push({ at: top, text: `RPH ${cm(sill)}`, angle: a2, anchor: 'middle', pad: flip ? 0.9 : -0.9 });
  }
  return out;
}

export const formatM = (n: number) => `${formatMeasure(roundM(n))} m`;

/** Maßangaben eines Objekts (in m). */
export function annotationsOf(e: Pick<DrawElement, 'type' | 'shape' | 'showDims'> & Partial<Pick<DrawElement, 'symbol' | 'opening'>>): { dims: DimAnnotation[]; labels: DimLabel[] } {
  const dims: DimAnnotation[] = [];
  const labels: DimLabel[] = [];
  const s = e.shape;
  if (e.type === 'dimension') {
    const [a, b] = lineEnds(s);
    dims.push({ a, b, side: -1, text: formatM(dist(a, b)), inline: true, leader: true });
    return { dims, labels };
  }
  if (e.showDims === false) return { dims, labels };
  if (e.type === 'symbol') return { dims, labels: windowLabels(e) };
  // Unregelmäßiges Dreieck bzw. Polylinie: jede Seite mit ihrer Länge (aus den Eckpunkten berechnet);
  // offene Polylinie ohne Schlusskante
  if ((e.type === 'triangle' && !isRegularTriangle(s)) || (e.type === 'freehand' && (s.points?.length ?? 0) <= 12)) {
    const v = shapeVertices(s);
    const edges = e.type === 'freehand' && s.closed === false ? v.length - 1 : v.length;
    for (let i = 0; i < edges; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      dims.push({ a, b, side: -1, text: formatM(dist(a, b)), inline: true });
    }
    return { dims, labels };
  }
  const L = (p: Point) => fromShapeLocal(s, p);
  switch (e.type) {
    case 'rect':
      dims.push({ a: L({ x: s.x, y: s.y }), b: L({ x: s.x + s.w, y: s.y }), side: -1, text: formatM(s.w) });
      dims.push({ a: L({ x: s.x, y: s.y + s.h }), b: L({ x: s.x, y: s.y }), side: -1, text: formatM(s.h) });
      break;
    case 'triangle': {
      dims.push({ a: L({ x: s.x, y: s.y + s.h }), b: L({ x: s.x + s.w, y: s.y + s.h }), side: 1, text: formatM(s.w) });
      const ax = s.x + (s.points?.[0]?.[0] ?? 0.5) * s.w;
      const right = ax >= s.x + s.w / 2;
      const hx = right ? s.x + s.w : s.x;
      dims.push({ a: L({ x: hx, y: s.y + s.h }), b: L({ x: hx, y: s.y }), side: right ? 1 : -1, text: formatM(s.h) });
      break;
    }
    case 'line': {
      const [a, b] = lineEnds(s);
      dims.push({ a, b, side: -1, text: formatM(dist(a, b)), inline: true });
      break;
    }
    case 'ellipse':
      if (Math.abs(s.w - s.h) < 1e-6) labels.push({ at: shapeCenter(s), text: `Ø ${formatM(s.w)}` });
      else {
        dims.push({ a: L({ x: s.x, y: s.y }), b: L({ x: s.x + s.w, y: s.y }), side: -1, text: formatM(s.w) });
        dims.push({ a: L({ x: s.x, y: s.y + s.h }), b: L({ x: s.x, y: s.y }), side: -1, text: formatM(s.h) });
      }
      break;
  }
  return { dims, labels };
}

/**
 * Bildschirm- bzw. Papiergeometrie einer Maßkette: Hilfslinien, Maßlinie und Textposition.
 * `off` ist der Abstand der Maßlinie vom Objekt in Ausgabeeinheiten (px bzw. pt).
 */
export function dimGeometry(a: Point, b: Point, side: 1 | -1, off: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Normale (nach links bezogen auf a→b), Vorzeichen über side
  const nx = (-dy / len) * side;
  const ny = (dx / len) * side;
  const a2 = { x: a.x + nx * off, y: a.y + ny * off };
  const b2 = { x: b.x + nx * off, y: b.y + ny * off };
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Text immer lesbar (nicht auf dem Kopf)
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
  return { a2, b2, mid, angle, nx, ny, len };
}

// ---------------------------------------------------------------------------
// Planbereich und Vorschläge

/**
 * Zeichenblatt eines gezeichneten Plans (Seitenkoordinaten), sofern ein Papierformat gewählt
 * wurde; ältere gezeichnete Pläne ohne Format haben eine mitwachsende Zeichenfläche (undefined).
 */
export function drawingSheet(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>): Rect | undefined {
  return plan.drawing?.paper ? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight } : undefined;
}

/** Darzustellender Bereich eines gezeichneten Plans in Seitenkoordinaten. */
/** Begrenzung eines Zeichnungsobjekts in Seitenkoordinaten – Text mit Pfeil samt Pfeilspitze */
export function elementPageBox(e: Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>, k: number): Rect {
  const shape = shapeToPage(e.shape, k);
  const b = shapeAABB(shape);
  if (!e.leader) return b;
  const t = calloutTip(shape, e.leader, k);
  const x = Math.min(b.x, t.x);
  const y = Math.min(b.y, t.y);
  return { x, y, w: Math.max(b.x + b.w, t.x) - x, h: Math.max(b.y + b.h, t.y) - y };
}

export function drawingRegion(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>, elements: (Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>)[], damages: Pick<Damage, 'shape'>[] = []): Rect {
  const k = unitsPerMeter(plan);
  let x1 = 0;
  let y1 = 0;
  let x2 = plan.pageWidth;
  let y2 = plan.pageHeight;
  const add = (r: Rect) => {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  };
  for (const e of elements) add(elementPageBox(e, k));
  for (const d of damages) add(shapeAABB(d.shape));
  const pad = k; // 1 m Rand
  if (x1 < 0) x1 -= pad;
  if (y1 < 0) y1 -= pad;
  if (x2 > plan.pageWidth) x2 += pad;
  if (y2 > plan.pageHeight) y2 += pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Bereich des tatsächlichen Inhalts (Zeichnung und Markierungen) mit 1 m Rand – für den
 * Ausdruck, damit kleine Zeichnungen nicht verloren auf einer großen leeren Fläche stehen.
 * Ohne Inhalt: die ganze Zeichenfläche.
 */
export function contentRegion(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>, elements: (Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>)[], damages: Pick<Damage, 'shape'>[] = []): Rect {
  const k = unitsPerMeter(plan);
  const boxes = [...elements.map((e) => elementPageBox(e, k)), ...damages.map((d) => shapeAABB(d.shape))];
  if (!boxes.length) return { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const x1 = Math.min(...boxes.map((b) => b.x)) - k;
  const y1 = Math.min(...boxes.map((b) => b.y)) - k;
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + k;
  const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + k;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Maßvorschlag für eine Markierung auf einem gezeichneten Plan (der Maßstab ist bekannt):
 * Länge und Breite in m bzw. bei Linien die Länge.
 */
export function suggestMeasures(shape: Shape, k = UNITS_PER_M): { length: number; width: number | null } {
  const s = shapeToMeters(shape, k);
  if (s.type === 'line') return { length: round2(lineLength(s)), width: null };
  if (s.type === 'freehand' && s.closed === false) return { length: round2(pathLength(s)), width: null };
  return { length: round2(Math.max(s.w, s.h)), width: round2(Math.min(s.w, s.h)) };
}


/** Maßstab für den Ausdruck: kleinster Normmaßstab, bei dem der Bereich aufs Papier passt. */
export function printScale(regionM: { w: number; h: number }, paperMm: { w: number; h: number }, min = 0): number {
  const scales = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000];
  for (const n of scales) if (n >= min && (regionM.w * 1000) / n <= paperMm.w && (regionM.h * 1000) / n <= paperMm.h) return n;
  return scales[scales.length - 1];
}

/**
 * Druckausschnitt und Maßstab eines gezeichneten Plans mit Papierformat. Die Zeichenfläche ist
 * unbegrenzt: Liegt alles auf dem Zeichenblatt, wird genau das Blatt im gewählten Maßstab
 * gedruckt. Sonst wird der gesamte Inhalt gedruckt und – falls nötig – so weit verkleinert
 * (nächster Normmaßstab ≥ gewählter Maßstab), dass er auf das gewählte Format passt.
 */
export function printFit(
  plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>,
  elements: (Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>)[],
  damages: Pick<Damage, 'shape'>[],
  availMm: { w: number; h: number },
): { region: Rect; scale: number; fitted: boolean } {
  const k = unitsPerMeter(plan);
  const chosen = plan.drawing?.scale ?? 100;
  const sheet = { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const tol = 0.5;
  const onSheet = [...elements.map((e) => elementPageBox(e, k)), ...damages.map((d) => shapeAABB(d.shape))].every(
    (b) => b.x >= -tol && b.y >= -tol && b.x + b.w <= sheet.w + tol && b.y + b.h <= sheet.h + tol,
  );
  if (onSheet) return { region: sheet, scale: chosen, fitted: false };
  const region = contentRegion(plan, elements, damages);
  const scale = printScale({ w: region.w / k, h: region.h / k }, availMm, chosen);
  return { region, scale, fitted: scale !== chosen };
}


/**
 * Inhalt (Zeichnung und Markierungen) mit kleinem Rand: 4 % der größeren Seite, mindestens 10 cm.
 * Im Aufmaßplan füllt dieser Bereich immer das Blatt – egal wie groß die Zeichnung ist.
 */
export function fillRegion(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>, elements: (Pick<DrawElement, 'shape'> & Partial<Pick<DrawElement, 'leader'>>)[], damages: Pick<Damage, 'shape'>[] = []): Rect {
  const k = unitsPerMeter(plan);
  const boxes = [...elements.map((e) => elementPageBox(e, k)), ...damages.map((d) => shapeAABB(d.shape))];
  if (!boxes.length) return { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = Math.max(0.1 * k, 0.04 * Math.max(x2 - x1, y2 - y1));
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + 2 * pad, h: y2 - y1 + 2 * pad };
}

/** Papierformat im Aufmaßplan: das gewählte, sonst A3 passend zur Zeichnung (quer/hoch) */
export function aufmassPaper(plan: Pick<Plan, 'drawing'>, region: { w: number; h: number }): PaperFormat {
  return plan.drawing?.paper ?? (region.w >= region.h ? 'A3-quer' : 'A3-hoch');
}

/**
 * Blatt im Aufmaß (Plan messen): der Planbereich des Papierformats in Seiteneinheiten – genau der Ausschnitt,
 * der im PDF auf dem Blatt steht. Die Zeichnung füllt das Blatt immer und steht zentriert (der Maßstab des
 * Zeichenblatts wird dafür nicht eingehalten).
 */
export function printSheetRect(
  plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>,
  elements: Pick<DrawElement, 'shape'>[],
  damages: Pick<Damage, 'shape'>[],
): Rect | null {
  const region = fillRegion(plan, elements, damages);
  const fmt = PAPER[aufmassPaper(plan, region)];
  const avail = { w: fmt.w - 2 * PRINT_MARGIN_MM, h: fmt.h - 2 * PRINT_MARGIN_MM - PRINT_HEADER_MM };
  // mm auf dem Papier je Seiteneinheit
  const mmPerUnit = Math.min(avail.w / region.w, avail.h / region.h);
  const w = avail.w / mmPerUnit;
  const h = avail.h / mmPerUnit;
  return { x: region.x + region.w / 2 - w / 2, y: region.y + region.h / 2 - h / 2, w, h };
}
