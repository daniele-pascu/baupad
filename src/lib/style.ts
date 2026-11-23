import { isOpenShape, pathToSvg, pointInPolygon, shapePath, shapeVertices, type Point } from './geometry';
import type { HatchPattern, LineType, Shape, ShapeStyle } from './types';
import { DIN_HATCHES, dinCode, dinHatch, dinPattern, drawDin, type CellTools, type DinGroup, type LineSpec } from './hatch-din';

/**
 * Darstellung von Linien und Formen (Bildschirm und PDF gleich): Linientyp, Linienstärke,
 * Füllung. Alles hier ist reine Darstellung – Geometrie, Länge, Fläche und Umfang werden
 * weiterhin aus der gespeicherten Form berechnet.
 */

export const LINE_TYPES: { id: LineType; label: string }[] = [
  { id: 'solid', label: 'Durchgezogen' },
  { id: 'dashed', label: 'Gestrichelt' },
  { id: 'dashedShort', label: 'Kurz gestrichelt' },
  { id: 'dashedLong', label: 'Lang gestrichelt' },
  { id: 'doubleDash', label: 'Doppelt gestrichelt' },
  { id: 'dotted', label: 'Gepunktet' },
  { id: 'dottedDense', label: 'Dicht gepunktet' },
  { id: 'dashdot', label: 'Strich-Punkt' },
  { id: 'dashdotdot', label: 'Strich-Punkt-Punkt' },
  { id: 'dash2dot', label: 'Strich-Zwei-Punkte (lang)' },
  { id: 'center', label: 'Mittellinie' },
  { id: 'axis', label: 'Achslinie' },
  { id: 'border', label: 'Begrenzungslinie' },
  { id: 'hidden', label: 'Verdeckte Linie' },
  { id: 'wave', label: 'Wellenlinie' },
  { id: 'zigzag', label: 'Zickzacklinie' },
];

/** Musterlänge der Striche (Faktor) */
export const DASH_SCALES = [0.5, 0.75, 1, 1.5, 2, 3];

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
  dashedShort: [2.4, 2.2],
  dashedLong: [12, 4],
  doubleDash: [6, 2.2, 6, 6],
  dotted: [0, 2.4],
  dottedDense: [0, 1.6],
  dashdot: [8, 2.6, 0, 2.6],
  dashdotdot: [8, 2.6, 0, 2.6, 0, 2.6],
  dash2dot: [14, 2.6, 0, 2.6, 0, 2.6],
  // Mittellinie: lang – kurz; Achslinie: sehr lang – Punkt; Begrenzung: zwei Striche – Punkt
  center: [16, 3, 4, 3],
  axis: [22, 3, 0, 3],
  border: [10, 3, 10, 3, 0, 3],
  hidden: [4, 2.6],
};

/** Strichmuster für eine Linienstärke (in derselben Einheit); undefined = durchgezogen bzw. Welle/Zickzack. scale: Musterlänge */
export function dashArray(type: LineType | undefined, width: number, scale = 1): number[] | undefined {
  const p = type ? PATTERNS[type] : undefined;
  const unit = Math.max(width, 1) * (scale > 0 ? scale : 1);
  // Lücken nach Punkten (Länge 0) bleiben an die Stärke gebunden, damit Punkte rund bleiben
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

/**
 * Schraffuren zur Auswahl: der Katalog nach DIN ISO 128-50 in Schwarz-Weiß (Kurzzeichen und Bezeichnung der Norm).
 * Der Winkel dreht jedes Muster gegenüber der Normdarstellung, der Abstand skaliert es.
 */
export const HATCH_PATTERNS: { id: HatchPattern; label: string; code: string; group: DinGroup }[] = DIN_HATCHES.map((h) => ({ id: dinPattern(h.code), label: `${h.code} · ${h.label}`, code: h.code, group: h.group }));

/** frühere Muster: nicht mehr zur Auswahl – bestehende Pläne zeigen sie unverändert weiter */
const LEGACY_HATCH_LABELS: Record<string, string> = {
  lines: 'Diagonal / Linien',
  cross: 'Kreuzschraffur',
  horizontal: 'Waagrecht',
  vertical: 'Senkrecht',
  grid: 'Gitter',
  dense: 'Dicht',
  dots: 'Punkte',
  brick: 'Ziegel',
  concrete: 'Beton',
  reinforced: 'Stahlbeton',
  earth: 'Erdreich',
  gravel: 'Kies / Schüttung',
  insulationSoft: 'Dämmstoff weich',
  insulationHard: 'Dämmstoff hart',
  wood: 'Holz',
  woodBased: 'Holzwerkstoff',
  metal: 'Metall / Stahl',
  stone: 'Stein',
  glass: 'Glas',
  plastic: 'Kunststoff',
  gypsum: 'Gips',
  sealing: 'Dichtstoff',
  demolish: 'Abbruch (Y-Zeichen)',
};
/** Bezeichnung eines Musters (Katalog bzw. früheres Muster mit dem Zusatz „bisher“) */
export const hatchName = (pattern: HatchPattern): string => HATCH_PATTERNS.find((p) => p.id === pattern)?.label ?? (LEGACY_HATCH_LABELS[pattern] ? `${LEGACY_HATCH_LABELS[pattern]} (bisher)` : pattern);
/** früheres Muster (nicht mehr im Katalog) */
export const isLegacyHatch = (pattern: HatchPattern) => !dinCode(pattern);

/** Vorgabe für gespeicherte Schraffuren ohne eigene Angabe (frühere Pläne) – nicht ändern */
export const DEFAULT_HATCH = { pattern: 'lines' as HatchPattern, angle: 45, spacing: 6 };
/** Vorgabe für eine neue Schraffur: Grundschraffur der Norm */
export const NEW_HATCH = { pattern: dinPattern('U'), angle: 0, spacing: 3 };

export interface Fill {
  color: string;
  opacity: number;
  /** Schraffur statt Vollton */
  hatch?: { pattern: HatchPattern; angle: number; spacing: number };
  /** Flächenfarbe hinter der Schraffur */
  bg?: string;
}

/** Füllung einer Form (null = keine Füllung, offene Linien nie) */
export function fillOf(shape: Shape, color: string, style: ShapeStyle | undefined, defaultTransparency: number): Fill | null {
  if (isOpenShape(shape) || style?.noFill) return null;
  const hatch = style?.fillType === 'hatch' ? { ...DEFAULT_HATCH, ...style.hatch } : undefined;
  // Schraffurlinien sind ohne eigene Angabe deckend (sonst kaum sichtbar)
  const t = Math.min(100, Math.max(0, style?.fillTransparency ?? (hatch ? 0 : defaultTransparency)));
  return { color: style?.fillColor ?? color, opacity: 1 - t / 100, ...(hatch ? { hatch } : {}), ...(hatch && style?.hatchBg ? { bg: style.hatchBg } : {}) };
}

/** höchstens so viele Schraffurlinien bzw. -striche je Form (Schutz bei sehr großen Flächen) */
const MAX_HATCH_LINES = 1500;
const MAX_HATCH_SEGMENTS = 9000;
const MAX_HATCH_FILLS = 6000;

/** feste Pseudozufallszahl 0..1 je Rasterzelle (gleiches Bild am Bildschirm und im PDF) */
const rnd = (i: number, j: number, k = 0) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Strecke a–b auf die Fläche beschneiden (gerade-ungerade-Regel) */
function clipSegment(a: Point, b: Point, poly: Point[]): [Point, Point][] {
  const ts = [0, 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((u, v) => u - v);
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const m = (ts[i] + ts[i + 1]) / 2;
    if (ts[i + 1] - ts[i] < 1e-9) continue;
    if (pointInPolygon({ x: a.x + dx * m, y: a.y + dy * m }, poly)) out.push([{ x: a.x + dx * ts[i], y: a.y + dy * ts[i] }, { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] }]);
  }
  return out;
}

/**
 * Schraffur einer Fläche in Ausgabekoordinaten: Linienmuster (parallel, gekreuzt, Gitter …) bzw.
 * Baustoffmuster (Ziegel, Beton, Erdreich, Dämmstoff, Holz …) im Winkel, auf die Fläche beschnitten.
 * Nur Darstellung – die Geometrie der Form bleibt unverändert.
 */
export interface HatchGeometry {
  segments: [Point, Point][];
  dots: Point[];
  /** gefüllte Flächen (geschlossene Vielecke, nicht beschnitten – der Zeichner beschneidet sie auf die Form) */
  fills: Point[][];
}
export function hatchGeometry(poly: Point[], pattern: HatchPattern, angle: number, spacing: number): HatchGeometry {
  // Zu fein für die Fläche (Obergrenze der Striche erreicht): nicht mittendrin abbrechen, sondern das ganze Muster
  // schrittweise gröber zeichnen, bis es vollständig ist
  let geo = hatchGeometryAt(poly, pattern, angle, spacing);
  for (let i = 0, sp = spacing; geo.cut && i < 10; i++) {
    sp *= 1.5;
    geo = hatchGeometryAt(poly, pattern, angle, sp);
  }
  return { segments: geo.segments, dots: geo.dots, fills: geo.fills };
}

function hatchGeometryAt(poly: Point[], pattern: HatchPattern, angle: number, spacing: number): HatchGeometry & { cut: boolean } {
  const segments: [Point, Point][] = [];
  const dots: Point[] = [];
  const fills: Point[][] = [];
  /** Obergrenze erreicht – das Muster wäre unvollständig */
  let cut = false;
  const done = () => ({ segments, dots, fills, cut: cut || segments.length >= MAX_HATCH_SEGMENTS || dots.length >= MAX_HATCH_SEGMENTS || fills.length >= MAX_HATCH_FILLS });
  if (poly.length < 3 || !(spacing > 0)) return done();

  /** parallele Linien (schnell, Abtastlinien) */
  const run = (deg: number, asDots: boolean, sp = spacing) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Fläche so drehen, dass die Schraffur waagrecht verläuft
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const back = (x: number, y: number): Point => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const ys = rot.map((p) => p.y);
    const y0 = Math.ceil(Math.min(...ys) / sp) * sp;
    const y1 = Math.max(...ys);
    let count = 0;
    for (let y = y0; y <= y1 && count < MAX_HATCH_LINES; y += sp, count++) {
      const xs: number[] = [];
      for (let i = 0; i < rot.length; i++) {
        const p = rot[i];
        const q = rot[(i + 1) % rot.length];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (asDots) {
          for (let x = Math.ceil(xs[i] / sp) * sp; x <= xs[i + 1]; x += sp) dots.push(back(x, y));
        } else segments.push([back(xs[i], y), back(xs[i + 1], y)]);
      }
    }
    if (count >= MAX_HATCH_LINES) cut = true;
  };

  /**
   * Muster aus kurzen Strichen je Rasterzelle (gedrehtes Raster, Zellgröße cw × ch), beschnitten.
   * cell(i, j, x, y) liefert Striche bzw. Punkte im gedrehten System.
   */
  const cells = (deg: number, cw: number, ch: number, cell: (i: number, j: number, x: number, y: number, add: (a: Point, b: Point) => void, dot: (p: Point) => void, fill: (pts: Point[]) => void) => void) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const back = (p: Point): Point => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    const xs = rot.map((p) => p.x);
    const ys = rot.map((p) => p.y);
    // zwei Zellen Rand: Zeichen dürfen aus ihrer Zelle ragen bzw. je Reihe versetzt sein
    const i0 = Math.floor(Math.min(...xs) / cw) - 2;
    const i1 = Math.ceil(Math.max(...xs) / cw) + 1;
    const j0 = Math.floor(Math.min(...ys) / ch) - 1;
    const j1 = Math.ceil(Math.max(...ys) / ch) + 1;
    if ((i1 - i0) * (j1 - j0) > 40000) {
      cut = true; // zu fein für die Fläche
      return;
    }
    const add = (p: Point, q: Point) => {
      if (segments.length < MAX_HATCH_SEGMENTS) segments.push(...clipSegment(back(p), back(q), poly));
    };
    const dot = (p: Point) => {
      const b = back(p);
      if (dots.length < MAX_HATCH_SEGMENTS && pointInPolygon(b, poly)) dots.push(b);
    };
    const fill = (pts: Point[]) => {
      if (fills.length < MAX_HATCH_FILLS) fills.push(pts.map(back));
    };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cell(i, j, i * cw, j * ch, add, dot, fill);
  };
  /** kleiner Kreis als Striche */
  const ring = (add: (a: Point, b: Point) => void, c: Point, r: number, n = 8) => {
    for (let k = 0; k < n; k++) {
      const a1 = (k / n) * Math.PI * 2;
      const a2 = ((k + 1) / n) * Math.PI * 2;
      add({ x: c.x + Math.cos(a1) * r, y: c.y + Math.sin(a1) * r }, { x: c.x + Math.cos(a2) * r, y: c.y + Math.sin(a2) * r });
    }
  };
  /** Wellen- bzw. Zickzacklinien quer über die Fläche */
  const waves = (deg: number, sp: number, amp: number, period: number, zig: boolean, loops = false) =>
    cells(deg, period, sp, (_i, _j, x, y, add) => {
      const n = zig ? 2 : 8;
      for (let k = 0; k < n; k++) {
        const t1 = k / n;
        const t2 = (k + 1) / n;
        const f = (t: number) => (zig ? (t < 0.5 ? t * 2 : 2 - t * 2) * 2 - 1 : Math.sin(t * Math.PI * 2));
        const lx = (t: number) => x + t * period + (loops ? Math.sin(t * Math.PI * 2) * period * 0.35 : 0);
        add({ x: lx(t1), y: y + f(t1) * amp }, { x: lx(t2), y: y + f(t2) * amp });
      }
    });

  /**
   * Parallele Linien mit Wiederholung `period`: je Linie Versatz `at` und Strichlänge `dash` (0 = durchgezogen).
   */
  const stripes = (deg: number, period: number, lines: { at: number; dash: number }[]) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const back = (x: number, y: number): Point => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const ys = rot.map((p) => p.y);
    const y0 = Math.floor(Math.min(...ys) / period) * period;
    const y1 = Math.max(...ys);
    let count = 0;
    for (let base = y0; base <= y1 && count < MAX_HATCH_LINES; base += period) {
      for (const l of lines) {
        const y = base + l.at;
        const xs: number[] = [];
        for (let i = 0; i < rot.length; i++) {
          const p = rot[i];
          const q = rot[(i + 1) % rot.length];
          if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
        }
        xs.sort((u, v) => u - v);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          if (!l.dash) {
            segments.push([back(xs[i], y), back(xs[i + 1], y)]);
            continue;
          }
          // Strichlinie: Striche im festen Raster (unabhängig vom Anfang der Fläche)
          const step = l.dash * 2;
          for (let x = Math.ceil(xs[i] / step) * step; x < xs[i + 1] && segments.length < MAX_HATCH_SEGMENTS; x += step) segments.push([back(x, y), back(Math.min(x + l.dash, xs[i + 1]), y)]);
        }
        count++;
      }
    }
  };
  /**
   * Striche innen am Rand der Fläche (Stein, Glas): alle `every` ein Strich bzw. eine Gruppe von `group` Strichen
   * (Abstand `gap`), Länge `len`, Winkel `deg` zur Kante (90 = senkrecht nach innen).
   */
  const edgeTicks = (every: number, len: number, deg: number, group = 1, gap = 0) => {
    const area2 = poly.reduce((acc, p, i) => acc + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0);
    const inward = area2 > 0 ? 1 : -1; // Normale nach innen (Bildschirm: y nach unten)
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < every * 0.5) continue;
      const ux = (q.x - p.x) / L;
      const uy = (q.y - p.y) / L;
      const nx = -uy * inward;
      const ny = ux * inward;
      const a = (deg * Math.PI) / 180;
      const dx = ux * Math.cos(a) + nx * Math.sin(a);
      const dy = uy * Math.cos(a) + ny * Math.sin(a);
      const n = Math.floor((L - every * 0.3) / every);
      const start = (L - n * every) / 2;
      for (let k = 0; k <= n && segments.length < MAX_HATCH_SEGMENTS; k++) {
        for (let g = 0; g < group; g++) {
          const t = start + k * every + (g - (group - 1) / 2) * gap;
          if (t < 0 || t > L) continue;
          const b = { x: p.x + ux * t, y: p.y + uy * t };
          segments.push(...clipSegment(b, { x: b.x + dx * len, y: b.y + dy * len }, poly));
        }
      }
    }
  };

  /**
   * Schar paralleler Linien (Wiederholung `period`): je Linie Versatz quer, Strichmuster (Strich, Lücke, …) mit
   * Verschiebung längs – im festen Raster, unabhängig vom Anfang der Fläche – bzw. Punkte im Abstand `dots`.
   */
  const lineSet = (deg: number, period: number, specs: LineSpec[]) => {
    if (!(period > 0)) return;
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const back = (x: number, y: number): Point => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const ys = rot.map((p) => p.y);
    const y0 = (Math.floor(Math.min(...ys) / period) - 1) * period;
    const y1 = Math.max(...ys);
    let count = 0;
    if ((y1 - y0) / period > MAX_HATCH_LINES) cut = true;
    for (let base = y0; base <= y1 && count < MAX_HATCH_LINES * 2; base += period) {
      for (const l of specs) {
        const y = base + l.at;
        const xs: number[] = [];
        for (let i = 0; i < rot.length; i++) {
          const p = rot[i];
          const q = rot[(i + 1) % rot.length];
          if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
        }
        if (!xs.length) continue;
        count++;
        xs.sort((u, v) => u - v);
        const phase = l.phase ?? 0;
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = xs[i];
          const xb = xs[i + 1];
          if (l.dots) {
            for (let x = Math.ceil((xa - phase) / l.dots) * l.dots + phase; x <= xb && dots.length < MAX_HATCH_SEGMENTS; x += l.dots) dots.push(back(x, y));
            continue;
          }
          if (!l.dash?.length) {
            if (segments.length < MAX_HATCH_SEGMENTS) segments.push([back(xa, y), back(xb, y)]);
            continue;
          }
          const total = l.dash.reduce((u, v) => u + v, 0);
          if (!(total > 0)) continue;
          for (let x = Math.floor((xa - phase) / total) * total + phase; x < xb && segments.length < MAX_HATCH_SEGMENTS; x += total) {
            let o = x;
            for (let k = 0; k < l.dash.length; k += 2) {
              const from = Math.max(o, xa);
              const to = Math.min(o + l.dash[k], xb);
              if (to - from > 1e-9) segments.push([back(from, y), back(to, y)]);
              o += l.dash[k] + (l.dash[k + 1] ?? 0);
            }
          }
        }
      }
    }
  };
  /** Bezugssystem im Winkel `deg`: x in Musterrichtung, y quer – mit den Grenzen der Form darin (für Bänder über die ganze Dicke) */
  const frame = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));
    const xs = rot.map((p) => p.x);
    const ys = rot.map((p) => p.y);
    return { back: (x: number, y: number): Point => ({ x: x * cos - y * sin, y: x * sin + y * cos }), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  /**
   * Dämmstoff: „Tropfen“ über die ganze Dicke der Schicht (quer zum eingestellten Winkel: 0° = waagrechte Schicht,
   * 90° = senkrechte); sehr dicke Flächen in mehreren gleich hohen Lagen.
   */
  const insulation = () => {
    const f = frame(angle);
    const H = f.y1 - f.y0;
    if (!(H > 0)) return;
    const rows = Math.max(1, Math.round(H / (spacing * 7)));
    const rowH = H / rows;
    // je Lage abwechselnd „Tropfen“: runder Bogen an einem Rand, die Seiten laufen am anderen Rand spitz zusammen –
    // die nach oben und die nach unten gerichteten greifen ineinander und füllen die ganze Dicke
    const w = rowH * 0.62;
    const rx = w / 2;
    const ry = rowH * 0.3;
    const inset = rowH * 0.03;
    const n = 10;
    const put = (a: Point, b: Point) => {
      if (segments.length < MAX_HATCH_SEGMENTS) segments.push(...clipSegment(a, b, poly));
    };
    for (let r = 0; r < rows; r++) {
      const top = f.y0 + r * rowH + inset;
      const bot = f.y0 + (r + 1) * rowH - inset;
      for (let x = Math.floor(f.x0 / w - 1) * w; x < f.x1 + w; x += w) {
        // dir = 1: Bogen oben, Spitze unten; dir = -1: umgekehrt, um eine halbe Breite versetzt
        for (const dir of [1, -1]) {
          const cx = x + (dir > 0 ? 0 : rx);
          const edge = dir > 0 ? top : bot; // Rand mit dem Bogen
          const tip = dir > 0 ? bot : top; // Rand mit der Spitze
          const cy = edge + dir * ry;
          for (let k = 0; k < n; k++) {
            const a1 = Math.PI * (k / n);
            const a2 = Math.PI * ((k + 1) / n);
            put(f.back(cx - rx * Math.cos(a1), cy - dir * ry * Math.sin(a1)), f.back(cx - rx * Math.cos(a2), cy - dir * ry * Math.sin(a2)));
          }
          put(f.back(cx - rx, cy), f.back(cx, tip));
          put(f.back(cx + rx, cy), f.back(cx, tip));
        }
      }
    }
  };
  /**
   * Dichtstoff: schwarz-weißes Band entlang der Fuge – als einzige Schraffur richtet es sich selbst nach der Form aus
   * (der Winkel spielt keine Rolle) und folgt auch jedem Knick: Es läuft entlang der Mittellinie des Streifens.
   * Schmale Formen (z. B. 1 m × 0,01 m) füllt es über die ganze Breite; in breiten Flächen liegt es als Band in der
   * Mitte, mit je einer Linie darüber und darunter.
   */
  const sealant = () => {
    const strip = stripSides(poly);
    if (!strip) {
      // keine Streifenform (z. B. ungerade Eckenzahl): gerades Band in Längsrichtung der Fläche
      const f = frame(narrowAxis(poly));
      const H = f.y1 - f.y0;
      if (!(H > 0)) return;
      const narrow = H <= spacing * 6;
      const bh = narrow ? H : spacing * 1.2;
      const top = narrow ? f.y0 : (f.y0 + f.y1) / 2 - bh / 2;
      const len = Math.max(bh * 2.5, spacing * 2);
      for (let x = Math.floor(f.x0 / (2 * len)) * 2 * len; x < f.x1 && fills.length < MAX_HATCH_FILLS; x += 2 * len) {
        fills.push([f.back(x, top), f.back(x + len, top), f.back(x + len, top + bh), f.back(x, top + bh)]);
      }
      if (!narrow) for (const y of [top, top + bh]) segments.push(...clipSegment(f.back(f.x0 - 1, y), f.back(f.x1 + 1, y), poly));
      return;
    }
    const { A, B, width } = strip;
    const m = A.length;
    const narrow = width <= spacing * 6;
    const bh = narrow ? width : spacing * 1.2;
    // Mittellinie und ihre Längen
    const C = A.map((p, k) => ({ x: (p.x + B[k].x) / 2, y: (p.y + B[k].y) / 2 }));
    const cum = [0];
    for (let k = 1; k < m; k++) cum.push(cum[k - 1] + Math.hypot(C[k].x - C[k - 1].x, C[k].y - C[k - 1].y));
    const total = cum[m - 1];
    if (!(total > 0)) return;
    const lerp = (p: Point, q: Point, u: number): Point => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    /** Randpunkt des Bands an der Stelle (Abschnitt k, Anteil u): side 0 = Seite A, 1 = Seite B */
    const edge = (k: number, u: number, side: 0 | 1): Point => {
      const pa = lerp(A[k], A[Math.min(k + 1, m - 1)], u);
      const pb = lerp(B[k], B[Math.min(k + 1, m - 1)], u);
      if (narrow) return side ? pb : pa;
      const c = lerp(pa, pb, 0.5);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      const sgn = side ? -1 : 1;
      return { x: c.x + (((pa.x - pb.x) / d) * sgn * bh) / 2, y: c.y + (((pa.y - pb.y) / d) * sgn * bh) / 2 };
    };
    /** Stelle auf der Mittellinie im Abstand t vom Anfang */
    const at = (t: number): { k: number; u: number } => {
      for (let k = 0; k + 1 < m; k++) if (t <= cum[k + 1] || k === m - 2) return { k, u: cum[k + 1] > cum[k] ? Math.min(1, Math.max(0, (t - cum[k]) / (cum[k + 1] - cum[k]))) : 0 };
      return { k: 0, u: 0 };
    };
    // Randpunkte eines Bandstücks von t1 bis t2 (mit allen Knicken dazwischen)
    const piece = (t1: number, t2: number, side: 0 | 1): Point[] => {
      const p1 = at(t1);
      const p2 = at(t2);
      const pts = [edge(p1.k, p1.u, side)];
      for (let k = p1.k + 1; k <= p2.k; k++) pts.push(edge(k, 0, side));
      pts.push(edge(p2.k, p2.u, side));
      return pts;
    };
    const len = Math.max(bh * 2.5, spacing * 2);
    for (let t = 0; t < total && fills.length < MAX_HATCH_FILLS; t += 2 * len) {
      const t2 = Math.min(total, t + len);
      fills.push([...piece(t, t2, 0), ...piece(t, t2, 1).reverse()]);
    }
    if (!narrow) {
      for (const side of [0, 1] as const) {
        const pts = piece(0, total, side);
        for (let i = 0; i + 1 < pts.length; i++) segments.push(...clipSegment(pts[i], pts[i + 1], poly));
      }
    }
  };

  // Schraffuren nach DIN ISO 128-50: aus den Bausteinen oben; der Winkel dreht das ganze Muster
  const din = dinCode(pattern);
  if (din) {
    const cellTools = (add: (a: Point, b: Point) => void, dot: (p: Point) => void, fill: (pts: Point[]) => void): CellTools => ({
      add,
      dot,
      ring: (c, r, n = 10) => ring(add, c, r, n),
      disc: (c, r) => fill(Array.from({ length: 14 }, (_, k) => ({ x: c.x + Math.cos((k / 14) * Math.PI * 2) * r, y: c.y + Math.sin((k / 14) * Math.PI * 2) * r }))),
      rect: (x, y, w, h) =>
        fill([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ]),
    });
    drawDin(din, {
      s: spacing,
      lines: (deg, period, specs) => lineSet(deg + angle, period, specs),
      cells: (cw, ch, cell) => cells(angle, cw, ch, (i, j, x, y, add, dot, fill) => cell(i, j, x, y, cellTools(add, dot, fill))),
      wave: (rowH, amp, period, zig) => waves(angle, rowH, amp, period, zig),
      insulation,
      sealant,
    });
    return done();
  }

  const s = spacing;
  switch (pattern) {
    case 'dots':
      run(angle, true);
      break;
    case 'cross':
      run(angle, false);
      run(angle + 90, false);
      break;
    case 'horizontal':
      run(0, false);
      break;
    case 'vertical':
      run(90, false);
      break;
    case 'grid':
      run(angle - 45, false);
      run(angle + 45, false);
      break;
    case 'dense':
      run(angle, false, s / 2.5);
      break;
    case 'sealing':
      // Dichtstoff: Band aus abwechselnd schwarzen und weißen Feldern (schwarz = dichte Striche)
      cells(angle, s * 3, s * 1.2, (i, j, x, y, add) => {
        if ((i + j) % 2) return;
        for (let k = 0; k <= 4; k++) add({ x, y: y + (k * s) / 5 }, { x: x + s * 3, y: y + (k * s) / 5 });
      });
      break;
    case 'metal':
      // Stahl: je zwei Linien, dazwischen eine Strichlinie (ÖNORM A 6240)
      stripes(angle, s * 3, [
        { at: 0, dash: 0 },
        { at: s * 0.6, dash: 0 },
        { at: s * 1.8, dash: s * 0.5 },
      ]);
      break;
    case 'demolish':
      // Abtrag: Reihen kleiner Y-Zeichen, jede zweite Reihe umgekehrt
      cells(angle, s, s, (_i, j, x, y, add) => {
        const cx = x + s / 2;
        const up = j % 2 === 0;
        const top = y + s * 0.2;
        const mid = y + s * 0.5;
        const bot = y + s * 0.8;
        if (up) {
          add({ x: cx, y: mid }, { x: cx, y: bot });
          add({ x: cx - s * 0.22, y: top }, { x: cx, y: mid });
          add({ x: cx + s * 0.22, y: top }, { x: cx, y: mid });
        } else {
          add({ x: cx, y: top }, { x: cx, y: mid });
          add({ x: cx, y: mid }, { x: cx - s * 0.22, y: bot });
          add({ x: cx, y: mid }, { x: cx + s * 0.22, y: bot });
        }
      });
      break;
    case 'brick':
      // Ziegelverband: Lagerfugen waagrecht, Stoßfugen versetzt
      run(angle, false, s);
      cells(angle, s * 2, s, (i, j, x, y, add) => {
        const off = j % 2 ? s : 0;
        add({ x: x + off, y }, { x: x + off, y: y + s });
        void i;
      });
      break;
    case 'concrete':
      // Unbewehrter Beton: schräge Reihen kurzer Striche (ÖNORM A 6240)
      stripes(angle, s, [{ at: 0, dash: s * 0.45 }]);
      break;
    case 'reinforced':
      // Bewehrter Beton: abwechselnd durchgezogene und gestrichelte Schräglinien (ÖNORM A 6240)
      stripes(angle, s * 2, [
        { at: 0, dash: 0 },
        { at: s, dash: s * 0.5 },
      ]);
      break;
    case 'earth':
      // Erdreich: Gruppen kurzer Schrägstriche, versetzt
      cells(angle, s * 2, s * 1.5, (i, j, x, y, add) => {
        if ((i + j) % 2) return;
        for (let k = 0; k < 3; k++) add({ x: x + k * s * 0.35, y: y + s }, { x: x + k * s * 0.35 + s * 0.6, y });
      });
      break;
    case 'gravel':
      cells(0, s * 1.2, s * 1.2, (i, j, x, y, add, dot) => {
        ring(add, { x: x + rnd(i, j) * s * 0.6 + s * 0.3, y: y + rnd(i, j, 1) * s * 0.6 + s * 0.3 }, s * (0.18 + rnd(i, j, 2) * 0.16), 7);
        if (rnd(i, j, 3) < 0.4) dot({ x: x + rnd(i, j, 4) * s, y: y + rnd(i, j, 5) * s });
      });
      break;
    case 'insulationSoft':
      // Dämmstoff weich: Schlaufenlinie (ÖNORM A 6240)
      waves(angle, s, s * 0.45, s * 1.2, false, true);
      break;
    case 'insulationHard':
      // Dämmstoff hart: Zickzack (ÖNORM A 6240)
      waves(angle, s, s * 0.48, s * 0.6, true);
      break;
    case 'wood':
      // Holz: Schräglinien in unregelmäßigen Gruppen (Paar, einzeln)
      stripes(angle, s * 3, [
        { at: 0, dash: 0 },
        { at: s * 0.5, dash: 0 },
        { at: s * 1.8, dash: 0 },
      ]);
      break;
    case 'woodBased':
      // Holzwerkstoffe: Linien in Paaren (ÖNORM A 6240: senkrecht)
      stripes(angle, s * 2.6, [
        { at: 0, dash: 0 },
        { at: s * 0.45, dash: 0 },
        { at: s * 1.5, dash: 0 },
      ]);
      break;
    case 'stone':
      // Stein: kurze Kammstriche innen am Rand (ÖNORM A 6240)
      edgeTicks(s, s * 0.7, 90);
      break;
    case 'glass':
      // Glas: Gruppen aus drei kurzen Schrägstrichen innen am Rand (ÖNORM A 6240)
      edgeTicks(s * 4, s * 1.2, angle, 3, s * 0.45);
      break;
    case 'plastic':
      // Kunststoff: dichte Kreuzschraffur (ÖNORM A 6240)
      run(angle, false, s);
      run(angle + 90, false, s);
      break;
    case 'gypsum':
      // Gips (Gipskarton-, Gipsfaserplatte): Doppellinien
      stripes(angle, s * 2, [
        { at: 0, dash: 0 },
        { at: s * 0.35, dash: 0 },
      ]);
      break;
    default:
      run(angle, false);
  }
  return done();
}

/**
 * Streifenform erkennen (Fuge, auch mit Knicken): Vieleck mit gerader Eckenzahl, dessen Ecken sich paarweise
 * gegenüberliegen (Seite A: k-te Ecke, Seite B: k-te Ecke von hinten). Gewählt wird die Paarung mit der kleinsten
 * mittleren Breite – ihre Mitten bilden die Mittellinie. Liefert die beiden Seiten und die mittlere Breite.
 */
export function stripSides(poly: Point[]): { A: Point[]; B: Point[]; width: number } | null {
  const n = poly.length;
  if (n < 4 || n % 2 || n > 240) return null;
  const m = n / 2;
  let best = -1;
  let bestW = Infinity;
  for (let r = 0; r < n; r++) {
    let w = 0;
    for (let k = 0; k < m; k++) {
      const a = poly[(r + k) % n];
      const b = poly[(r + n - 1 - k) % n];
      w += Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (w / m < bestW - 1e-9) {
      bestW = w / m;
      best = r;
    }
  }
  if (best < 0 || !(bestW > 0)) return null;
  return { A: Array.from({ length: m }, (_, k) => poly[(best + k) % n]), B: Array.from({ length: m }, (_, k) => poly[(best + n - 1 - k) % n]), width: bestW };
}

/** Richtung (Grad) der Längsachse einer Fläche: quer dazu ist sie am schmalsten (bei wenigen Ecken exakt entlang einer Kante) */
export function narrowAxis(poly: Point[]): number {
  let best = Infinity;
  let deg = 0;
  const test = (ux: number, uy: number) => {
    // u = Längsrichtung, Breite = Ausdehnung quer dazu
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      const v = -p.x * uy + p.y * ux;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < best - 1e-9) {
      best = hi - lo;
      deg = (Math.atan2(uy, ux) * 180) / Math.PI;
    }
  };
  if (poly.length <= 64) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-12) test((b.x - a.x) / len, (b.y - a.y) / len);
    }
  } else for (let d = 0; d < 180; d += 3) test(Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180));
  // Richtung eindeutig (0 ≤ Grad < 180), damit das Band nicht je nach Zeichenrichtung kippt
  return ((deg % 180) + 180) % 180;
}

/** Schraffur als SVG-Pfad (Punkte als sehr kurze Striche mit runden Enden) */
export function hatchSvg(h: Pick<HatchGeometry, 'segments' | 'dots'>): string {
  const f = (n: number) => n.toFixed(2);
  return (
    h.segments.map(([a, b]) => `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`).join('') +
    h.dots.map((p) => `M${f(p.x)} ${f(p.y)}l0.01 0`).join('')
  );
}

/** nur die Punkte einer Schraffur als SVG-Pfad (sehr kurze Striche mit runden Enden) – für eine eigene, kräftigere Strichstärke */
export function hatchDotsSvg(h: Pick<HatchGeometry, 'dots'>): string {
  const f = (n: number) => n.toFixed(2);
  return h.dots.map((p) => `M${f(p.x)} ${f(p.y)}l0.01 0`).join('');
}

/** gefüllte Flächen einer Schraffur als SVG-Pfad (geschlossene Vielecke) – wird auf die Form beschnitten gezeichnet */
export function hatchFillSvg(h: Pick<HatchGeometry, 'fills'>): string {
  const f = (n: number) => n.toFixed(2);
  return h.fills.map((pts) => `M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`).join('');
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
  /** Musterlänge (Faktor) */
  dashScale = 1,
): { d: string; dash?: number[] } {
  if (type === 'wave' || type === 'zigzag') {
    const { points, closed } = outlinePoints(shape);
    // fein und ruhig: kleiner Ausschlag, kurze Wiederholung (Zickzack etwas enger)
    const { amp, period } = wavyMetrics(type, patternWidth);
    return { d: pointsToSvg(wavyPoints(points.map(map), closed, type, amp, period)) };
  }
  const dash = dashArray(type, patternWidth, dashScale);
  if (!dash) return { d: pathToSvg(shapePath(shape), map) };
  const { points, closed } = outlinePoints(shape);
  return { d: pathToSvg(shapePath(shape), map), dash: fitDash(dash, polyLength(points.map(map), closed), closed) };
}

/**
 * Füllung als Pfade in Ausgabekoordinaten: Vollton als Fläche (`solid`) bzw. Schraffur als
 * Linien (`hatch`, Strichstärke `hatchWidth`). `unit` = Ausgabeeinheiten je Punkt (Bildschirm: PX_PER_PT).
 */
/**
 * Füllung bzw. Schraffur als SVG-Pfade. `unit` = Ausgabe-Einheiten je pt (Strichstärke).
 * `anchor` (Einheiten der Form je pt auf dem Papier): Schraffur in den Koordinaten der Form berechnen – sie ist dann
 * am Plan fixiert (wandert beim Verschieben nicht mit) und wird beim Zoomen mit vergrößert wie auf dem Papier.
 * Ohne `anchor`: in Ausgabe-Koordinaten (PDF: Papier).
 */
export function fillPaths(
  shape: Shape,
  map: (p: Point) => Point,
  fill: Fill,
  unit: number,
  anchor?: number,
): { solid?: string; hatch?: string; hatchWidth: number; bg?: string; /** gefüllte Teile der Schraffur (z. B. Dichtstoff, Kohle) */ hatchFill?: string; /** Umriss der Form: darauf werden die gefüllten Teile beschnitten */ clip?: string; /** Punkte der Normschraffuren (eigener Pfad, Strichstärke dotWidth) */ hatchDots?: string; dotWidth?: number } {
  if (!fill.hatch) return { solid: pathToSvg(shapePath(shape), map), hatchWidth: 0 };
  const h = fill.hatch;
  const bg = fill.bg ? { bg: pathToSvg(shapePath(shape), map) } : {};
  const hatchWidth = (h.pattern === 'dots' ? 1.6 : 0.6) * unit;
  // Normschraffuren: Punkte als eigener Pfad, kräftiger als die Linien (sonst kaum zu sehen)
  const din = !!dinCode(h.pattern);
  const paths = (geo: HatchGeometry) => ({
    hatch: hatchSvg(din ? { segments: geo.segments, dots: [] } : geo),
    ...(din && geo.dots.length ? { hatchDots: hatchDotsSvg(geo), dotWidth: HATCH_DOT_WIDTH * unit } : {}),
    ...(geo.fills.length ? { hatchFill: hatchFillSvg(geo), clip: pathToSvg(shapePath(shape), map) } : {}),
  });
  if (anchor && anchor > 0) {
    const poly = outlinePoints(shape).points;
    // Ausgabe-Einheiten je Einheit der Form (Bildschirm: Zoom) – stark verkleinert nicht zu einer Fläche verschwimmen lassen
    const o = map({ x: 0, y: 0 });
    const e = map({ x: 1, y: 0 });
    const zoom = Math.hypot(e.x - o.x, e.y - o.y);
    // Bilder und Punktmuster brauchen verkleinert mehr Platz als reine Linien, sonst verschmelzen sie
    const motif = dinHatch(h.pattern) ? !dinHatch(h.pattern)!.lines : MOTIF_PATTERNS.has(h.pattern);
    const minOut = zoom > 0 ? ((motif ? HATCH_MIN_SCREEN_PT_MOTIF : HATCH_MIN_SCREEN_PT) * unit) / zoom : 0;
    const geo = hatchGeometry(poly, h.pattern, h.angle, Math.max(hatchSpacing(poly, h.spacing, anchor, h.pattern), minOut));
    const mapped: HatchGeometry = { segments: geo.segments.map(([a, b]) => [map(a), map(b)] as [Point, Point]), dots: geo.dots.map(map), fills: geo.fills.map((f) => f.map(map)) };
    return { hatchWidth, ...bg, ...paths(mapped) };
  }
  const poly = outlinePoints(shape).points.map(map);
  const geo = hatchGeometry(poly, h.pattern, h.angle, hatchSpacing(poly, h.spacing, unit, h.pattern));
  return { hatchWidth, ...bg, ...paths(geo) };
}

/** Schmale Flächen: mindestens so viele Schraffurlinien über die schmalste Breite (z. B. 0,30 m Wand → 6 Linien) */
export const HATCH_MIN_LINES = 6;
/** engster Abstand der Schraffurlinien auf dem Papier (pt ≈ 0,18 mm), damit sie nicht zu einer Fläche verlaufen */
export const HATCH_MIN_PT = 0.5;
const MOTIF_PATTERNS = new Set<HatchPattern>(['insulationSoft', 'insulationHard', 'wood', 'woodBased', 'stone', 'brick', 'earth', 'gravel', 'gypsum']);
/** engster Abstand am Bildschirm (pt, mal PX_PER_PT) – nur wenn der Plan stark verkleinert ist */
const HATCH_MIN_SCREEN_PT = 1.5;
const HATCH_MIN_SCREEN_PT_MOTIF = 3;
/** Strichstärke der Punkte in Normschraffuren (pt) – die Linien haben 0,6 pt */
export const HATCH_DOT_WIDTH = 1.2;
/** kleinster wählbarer Abstand (pt) – auch im Zentimeterbereich noch erkennbar */
export const HATCH_SPACING_MIN = 0.5;
export const HATCH_SPACING_MAX = 20;

/**
 * Schmalste Breite einer Fläche (Abstand zweier paralleler Geraden, zwischen denen sie liegt). Bei wenigen Ecken
 * exakt (senkrecht zu einer Kante), sonst in 3°-Schritten.
 */
export function minWidth(poly: Point[]): number {
  if (poly.length < 3) return 0;
  const dirs: [number, number][] = [];
  if (poly.length <= 64) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-12) dirs.push([-(b.y - a.y) / len, (b.x - a.x) / len]);
    }
  } else for (let d = 0; d < 180; d += 3) dirs.push([Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)]);
  let best = Infinity;
  for (const [nx, ny] of dirs) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      const v = p.x * nx + p.y * ny;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    best = Math.min(best, hi - lo);
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Abstand der Schraffurlinien in Ausgabe-Einheiten: gewählter Abstand (pt, mal `perPt`), bei schmalen Flächen dichter –
 * mindestens HATCH_MIN_LINES Linien über die schmalste Breite, aber nie enger als HATCH_MIN_PT auf dem Papier.
 */
export function hatchSpacing(poly: Point[], spacingPt: number, perPt: number, pattern: HatchPattern = 'lines'): number {
  const base = Math.max(HATCH_SPACING_MIN, spacingPt) * perPt;
  // Bilder (Dämmstoff, Kies, Ziegel …) behalten ihre Größe – nur reine Linien- und Punktmuster werden dichter
  const din = dinHatch(pattern);
  if (din ? !din.lines : MOTIF_PATTERNS.has(pattern)) return base;
  const w = minWidth(poly);
  if (!(w > 0)) return base;
  return Math.min(base, Math.max(HATCH_MIN_PT * perPt, w / HATCH_MIN_LINES));
}

/** Schraffur am Bildschirm: Seiteneinheiten je pt auf dem Papier – gezeichnete Pläne nach Maßstab (k Einheiten je m) */
export const hatchAnchor = (k: number, scale = 100) => (k * scale * 0.352778) / 1000;
