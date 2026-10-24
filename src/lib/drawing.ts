import { fromShapeLocal, freehandPoints, lineShape, polygonArea, shapeAABB, shapeCenter, shapeVertices, type Point } from './geometry';
import { formatMeasure } from './numbers';
import type { Damage, DrawElement, DrawingInfo, PaperFormat, Plan, Rect, Shape } from './types';

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
};
export const PAPER_FORMATS = Object.keys(PAPER) as PaperFormat[];
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
export function sheetFields(paper: PaperFormat, scale: number): Pick<Plan, 'drawing' | 'pageWidth' | 'pageHeight'> {
  const m = sheetMeters(paper, scale);
  return { drawing: { ...DRAWING_INFO, paper, scale }, pageWidth: Math.round(m.w * UNITS_PER_M), pageHeight: Math.round(m.h * UNITS_PER_M) };
}

export const paperLabel = (d: Plan['drawing']) => (d?.paper ? `${PAPER[d.paper].label} · 1:${d.scale ?? 100}` : '');

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
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
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

export function measuresOf(e: Pick<DrawElement, 'type' | 'shape'>): Measures {
  const s = e.shape;
  const rotation = s.rotation ?? 0;
  switch (e.type) {
    case 'rect':
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
      return { textHeight: s.h, rotation };
    default:
      return { rotation };
  }
}

/**
 * Ändert die Maße eines Objekts. Ein Bezugspunkt bleibt dabei fest:
 * Rechteck/Text links oben, Dreieck links unten, Linie Startpunkt, Kreis Mittelpunkt.
 */
export function applyMeasures(e: Pick<DrawElement, 'type' | 'shape' | 'text'>, m: Measures): Shape {
  const s = e.shape;
  switch (e.type) {
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
    case 'dimension': {
      const [a] = lineEnds(s);
      return lineFromMeasures(a, m.length ?? lineLength(s), m.angle ?? lineAngle(s), 'line');
    }
    case 'text': {
      const h = m.textHeight ?? s.h;
      const w = textWidth(e.text ?? '', h);
      return withRotation(resizeKeeping(s, w, h, { x: 0, y: 0 }), m.rotation);
    }
    default:
      return withRotation(s, m.rotation);
  }
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

/** Geschätzte Textbreite (Helvetica-ähnlich) in m bei Schrifthöhe h. */
export function textWidth(text: string, h: number): number {
  return roundM(Math.max(1, text.length) * h * 0.56);
}

export function textShape(at: Point, text: string, h: number): Shape {
  return { type: 'rect', x: roundM(at.x), y: roundM(at.y - h / 2), w: textWidth(text, h), h: roundM(h) };
}

// ---------------------------------------------------------------------------
// Raster und Einrasten

const GRID_STEPS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100];

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
}

/** Freistehende Beschriftung (z. B. „Ø 2,00 m“). */
export interface DimLabel {
  at: Point;
  text: string;
}

export const formatM = (n: number) => `${formatMeasure(roundM(n))} m`;

/** Maßangaben eines Objekts (in m). */
export function annotationsOf(e: Pick<DrawElement, 'type' | 'shape' | 'showDims'>): { dims: DimAnnotation[]; labels: DimLabel[] } {
  const dims: DimAnnotation[] = [];
  const labels: DimLabel[] = [];
  const s = e.shape;
  if (e.type === 'dimension') {
    const [a, b] = lineEnds(s);
    dims.push({ a, b, side: -1, text: formatM(dist(a, b)), inline: true });
    return { dims, labels };
  }
  if (e.showDims === false) return { dims, labels };
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
export function drawingRegion(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>, elements: Pick<DrawElement, 'shape'>[], damages: Pick<Damage, 'shape'>[] = []): Rect {
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
  for (const e of elements) add(shapeAABB(shapeToPage(e.shape, k)));
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
export function contentRegion(plan: Pick<Plan, 'pageWidth' | 'pageHeight' | 'drawing'>, elements: Pick<DrawElement, 'shape'>[], damages: Pick<Damage, 'shape'>[] = []): Rect {
  const k = unitsPerMeter(plan);
  const boxes = [...elements.map((e) => shapeAABB(shapeToPage(e.shape, k))), ...damages.map((d) => shapeAABB(d.shape))];
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Maßstab für den Ausdruck: kleinster Normmaßstab, bei dem der Bereich aufs Papier passt. */
export function printScale(regionM: { w: number; h: number }, paperMm: { w: number; h: number }): number {
  const scales = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000];
  for (const n of scales) if ((regionM.w * 1000) / n <= paperMm.w && (regionM.h * 1000) / n <= paperMm.h) return n;
  return scales[scales.length - 1];
}

