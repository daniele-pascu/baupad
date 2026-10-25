import { isOpenShape, pathToSvg, shapePath, shapeVertices, type Point } from './geometry';
import type { HatchPattern, LineType, Shape, ShapeStyle } from './types';

/**
 * Darstellung von Linien und Formen (Bildschirm und PDF gleich): Linientyp, Linienstärke,
 * Füllung. Alles hier ist reine Darstellung – Geometrie, Länge, Fläche und Umfang werden
 * weiterhin aus der gespeicherten Form berechnet.
 */

export const LINE_TYPES: { id: LineType; label: string }[] = [
  { id: 'solid', label: 'Durchgezogen' },
  { id: 'dashed', label: 'Gestrichelt' },
  { id: 'dotted', label: 'Gepunktet' },
  { id: 'dashdot', label: 'Strich-Punkt' },
  { id: 'dashdotdot', label: 'Strich-Punkt-Punkt' },
  { id: 'wave', label: 'Wellenlinie' },
  { id: 'zigzag', label: 'Zickzacklinie' },
];

/** Linienstärke in Punkt: dünn … dick */
export const LINE_WIDTH_MIN = 0.25;
export const LINE_WIDTH_MAX = 6;

/** Standard: Messungen leicht gefüllt, Zeichnungsobjekte kaum (bisherige Darstellung) */
export const DEFAULT_TRANSPARENCY = { damage: 88, element: 96 } as const;

/**
 * Strichmuster als Vielfache der Linienstärke (gepunktet: Punkte durch runde Enden). Lücken
 * sind etwas größer gewählt, weil die runden Linienenden jeden Strich um eine Stärke verlängern.
 */
const PATTERNS: Partial<Record<LineType, number[]>> = {
  dashed: [5, 3],
  dotted: [0, 2.4],
  dashdot: [8, 2.6, 0, 2.6],
  dashdotdot: [8, 2.6, 0, 2.6, 0, 2.6],
};

/** Strichmuster für eine Linienstärke (in derselben Einheit); undefined = durchgezogen bzw. Welle/Zickzack */
export function dashArray(type: LineType | undefined, width: number): number[] | undefined {
  const p = type ? PATTERNS[type] : undefined;
  const unit = Math.max(width, 1);
  return p?.map((v) => v * unit);
}

/**
 * Strichmuster gleichmäßig auf eine Linie verteilen: Das Muster wird leicht gestreckt bzw.
 * gestaucht (höchstens ± ½ Wiederholung), damit es ganzzahlig aufgeht – offene Linien beginnen
 * und enden mit einem Strich, geschlossene Formen schließen nahtlos. Nur Darstellung.
 */
export function fitDash(dash: number[], length: number, closed: boolean): number[] {
  const period = dash.reduce((a, b) => a + b, 0);
  if (!(period > 0) || !(length > 0)) return dash;
  // offen: n Wiederholungen + abschließender erster Strich (beide werden gleich skaliert)
  const tail = closed ? 0 : dash[0];
  const n = Math.max(1, Math.round((length - tail) / period));
  const f = length / (n * period + tail);
  return f > 0.5 && f < 2 ? dash.map((v) => v * f) : dash;
}

/** Länge einer Punktfolge (Ausgabekoordinaten) */
function polyLength(points: Point[], closed: boolean): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  if (closed && points.length > 1) l += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
  return l;
}

/** Wellen- und Zickzacklinie: Umriss wird nur für die Darstellung verformt */
export const isWavy = (t: LineType | undefined) => t === 'wave' || t === 'zigzag';

export const HATCH_PATTERNS: { id: HatchPattern; label: string }[] = [
  { id: 'lines', label: 'Linien' },
  { id: 'cross', label: 'Kreuzschraffur' },
  { id: 'dots', label: 'Punkte' },
];
export const DEFAULT_HATCH = { pattern: 'lines' as HatchPattern, angle: 45, spacing: 6 };

export interface Fill {
  color: string;
  opacity: number;
  /** Schraffur statt Vollton */
  hatch?: { pattern: HatchPattern; angle: number; spacing: number };
}

/** Füllung einer Form (null = keine Füllung, offene Linien nie) */
export function fillOf(shape: Shape, color: string, style: ShapeStyle | undefined, defaultTransparency: number): Fill | null {
  if (isOpenShape(shape) || style?.noFill) return null;
  const hatch = style?.fillType === 'hatch' ? { ...DEFAULT_HATCH, ...style.hatch } : undefined;
  // Schraffurlinien sind ohne eigene Angabe deckend (sonst kaum sichtbar)
  const t = Math.min(100, Math.max(0, style?.fillTransparency ?? (hatch ? 0 : defaultTransparency)));
  return { color: style?.fillColor ?? color, opacity: 1 - t / 100, ...(hatch ? { hatch } : {}) };
}

/** höchstens so viele Schraffurlinien je Form (Schutz bei sehr großen Flächen) */
const MAX_HATCH_LINES = 1500;

/**
 * Schraffur einer Fläche in Ausgabekoordinaten: parallele Linien im Winkel (Kreuzschraffur:
 * zusätzlich um 90° gedreht) bzw. Punkte im Raster, auf die Fläche beschnitten (gerade-ungerade-Regel).
 * Nur Darstellung – die Geometrie der Form bleibt unverändert.
 */
export function hatchGeometry(poly: Point[], pattern: HatchPattern, angle: number, spacing: number): { segments: [Point, Point][]; dots: Point[] } {
  const segments: [Point, Point][] = [];
  const dots: Point[] = [];
  if (poly.length < 3 || !(spacing > 0)) return { segments, dots };
  const run = (deg: number, asDots: boolean) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Fläche so drehen, dass die Schraffur waagrecht verläuft
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const back = (x: number, y: number): Point => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const ys = rot.map((p) => p.y);
    const y0 = Math.ceil(Math.min(...ys) / spacing) * spacing;
    const y1 = Math.max(...ys);
    let count = 0;
    for (let y = y0; y <= y1 && count < MAX_HATCH_LINES; y += spacing, count++) {
      const xs: number[] = [];
      for (let i = 0; i < rot.length; i++) {
        const p = rot[i];
        const q = rot[(i + 1) % rot.length];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (asDots) {
          for (let x = Math.ceil(xs[i] / spacing) * spacing; x <= xs[i + 1]; x += spacing) dots.push(back(x, y));
        } else segments.push([back(xs[i], y), back(xs[i + 1], y)]);
      }
    }
  };
  if (pattern === 'dots') run(angle, true);
  else {
    run(angle, false);
    if (pattern === 'cross') run(angle + 90, false);
  }
  return { segments, dots };
}

/** Schraffur als SVG-Pfad (Punkte als sehr kurze Striche mit runden Enden) */
export function hatchSvg(h: { segments: [Point, Point][]; dots: Point[] }): string {
  const f = (n: number) => n.toFixed(2);
  return (
    h.segments.map(([a, b]) => `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`).join('') +
    h.dots.map((p) => `M${f(p.x)} ${f(p.y)}l0.01 0`).join('')
  );
}

/** Umriss als Punktfolge (Seitenkoordinaten); Kreise werden fein angenähert. */
export function outlinePoints(shape: Shape): { points: Point[]; closed: boolean } {
  if (shape.type === 'ellipse') {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
    const pts: Point[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const x = (Math.cos(a) * shape.w) / 2;
      const y = (Math.sin(a) * shape.h) / 2;
      pts.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
    }
    return { points: pts, closed: true };
  }
  return { points: shapeVertices(shape), closed: !isOpenShape(shape) };
}

/**
 * Wellen- bzw. Zickzacklinie entlang einer Punktfolge (bereits in Ausgabekoordinaten).
 * amplitude/period in derselben Einheit; das Muster läuft über Ecken hinweg weiter.
 */
export function wavyPoints(points: Point[], closed: boolean, type: 'wave' | 'zigzag', amplitude: number, period: number): Point[] {
  const pts = closed ? [...points, points[0]] : points;
  // Periode so anpassen, dass das Muster ganzzahlig aufgeht (sauberes Ende, nahtlos geschlossen)
  const total = polyLength(points, closed);
  if (total > 0 && period > 0) period = total / Math.max(1, Math.round(total / period));
  const offset = (d: number) => {
    const f = d / period - Math.floor(d / period);
    if (type === 'wave') return Math.sin(f * Math.PI * 2) * amplitude;
    // Zickzack: Dreiecksfunktion mit Spitzen bei ¼ und ¾ der Periode
    return (f < 0.25 ? f * 4 : f < 0.75 ? 2 - f * 4 : f * 4 - 4) * amplitude;
  };
  // Stützstellen: Welle fein, Zickzack genau an den Spitzen (Viertelperioden)
  const q = type === 'wave' ? period / 12 : period / 4;
  const out: Point[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const at = (s: number) => ({ x: a.x + ux * s - uy * offset(dist + s), y: a.y + uy * s + ux * offset(dist + s) });
    if (!out.length) out.push(at(0));
    for (let s = Math.ceil(dist / q + 1e-9) * q - dist; s < len - 1e-9; s += q) out.push(at(s));
    out.push(at(len));
    dist += len;
  }
  return out;
}

/** Punktfolge als SVG-Pfad */
export const pointsToSvg = (pts: Point[], closed = false) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('') + (closed ? 'Z' : '');

/**
 * Ausschlag und Wiederholung von Welle/Zickzack zur Linienstärke (Ausgabeeinheit wie `width`,
 * Bildschirm: Pixel, PDF: Punkt) – unabhängig von Zoom und Messlänge.
 */
export function wavyMetrics(type: 'wave' | 'zigzag', width: number): { amp: number; period: number } {
  const w = Math.max(width, 0.5);
  return type === 'wave' ? { amp: 0.8 + w * 0.55, period: 5 + w * 2.6 } : { amp: 0.8 + w * 0.5, period: 3.6 + w * 2 };
}

/** Bildschirm: Pixel je Punkt Linienstärke (Linien bleiben beim Zoomen gleich dick) */
export const PX_PER_PT = 1.6;

/**
 * Pfad der Umrandung in Ausgabekoordinaten (`map`) samt Strichmuster. Wellen-/Zickzacklinien
 * werden als verformter Pfad ausgegeben; die Füllung nutzt immer die unveränderte Form.
 */
export function strokeGeometry(
  shape: Shape,
  map: (p: Point) => Point,
  type: LineType | undefined,
  width: number,
  /** Stärke, nach der sich das Muster richtet (z. B. ohne Auswahl-Hervorhebung) */
  patternWidth = width,
): { d: string; dash?: number[] } {
  if (type === 'wave' || type === 'zigzag') {
    const { points, closed } = outlinePoints(shape);
    // fein und ruhig: kleiner Ausschlag, kurze Wiederholung (Zickzack etwas enger)
    const { amp, period } = wavyMetrics(type, patternWidth);
    return { d: pointsToSvg(wavyPoints(points.map(map), closed, type, amp, period)) };
  }
  const dash = dashArray(type, patternWidth);
  if (!dash) return { d: pathToSvg(shapePath(shape), map) };
  const { points, closed } = outlinePoints(shape);
  return { d: pathToSvg(shapePath(shape), map), dash: fitDash(dash, polyLength(points.map(map), closed), closed) };
}

/**
 * Füllung als Pfade in Ausgabekoordinaten: Vollton als Fläche (`solid`) bzw. Schraffur als
 * Linien (`hatch`, Strichstärke `hatchWidth`). `unit` = Ausgabeeinheiten je Punkt (Bildschirm: PX_PER_PT).
 */
export function fillPaths(shape: Shape, map: (p: Point) => Point, fill: Fill, unit: number): { solid?: string; hatch?: string; hatchWidth: number } {
  if (!fill.hatch) return { solid: pathToSvg(shapePath(shape), map), hatchWidth: 0 };
  const poly = outlinePoints(shape).points.map(map);
  const h = fill.hatch;
  const geo = hatchGeometry(poly, h.pattern, h.angle, Math.max(1.5, h.spacing) * unit);
  return { hatch: hatchSvg(geo), hatchWidth: (h.pattern === 'dots' ? 1.6 : 0.6) * unit };
}
