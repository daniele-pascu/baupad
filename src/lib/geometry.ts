import type { Rect, Shape } from './types';

export interface Point {
  x: number;
  y: number;
}

/** Ansichtstransformation: Bildschirm = Seite · scale + (tx, ty) */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
export const toPage = (v: View, p: Point): Point => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });

/** Ansicht, die das Rechteck `r` mittig in einen Bereich der Größe w×h einpasst. */
export function fitView(r: Rect, w: number, h: number, padding = 16): View {
  const scale = Math.max(1e-4, Math.min((w - 2 * padding) / r.w, (h - 2 * padding) / r.h));
  return {
    scale,
    tx: (w - r.w * scale) / 2 - r.x * scale,
    ty: (h - r.h * scale) / 2 - r.y * scale,
  };
}

/** Zoomt um den Bildschirmpunkt `c` um den Faktor `factor`. */
export function zoomAt(v: View, c: Point, factor: number, min: number, max: number): View {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const f = scale / v.scale;
  return { scale, tx: c.x - (c.x - v.tx) * f, ty: c.y - (c.y - v.ty) * f };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectContains(r: Rect, p: Point, tol = 0): boolean {
  return p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function shapeBounds(s: Shape): Rect {
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Freihand-Punkte in Seitenkoordinaten. */
export function freehandPoints(s: Shape): Point[] {
  return (s.points ?? []).map(([u, v]) => ({ x: s.x + u * s.w, y: s.y + v * s.h }));
}

/** Prüft, ob ein Seitenpunkt eine Form trifft (tol in Seiteneinheiten). */
export function hitShape(s: Shape, p: Point, tol: number): boolean {
  if (!rectContains(s, p, tol)) return false;
  if (s.type === 'rect') return true;
  if (s.type === 'ellipse') {
    const rx = s.w / 2 + tol;
    const ry = s.h / 2 + tol;
    const dx = p.x - (s.x + s.w / 2);
    const dy = p.y - (s.y + s.h / 2);
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  const pts = freehandPoints(s);
  return pointInPolygon(p, pts) || distanceToPolyline(p, pts, true) <= tol;
}

export function pointInPolygon(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToPolyline(p: Point, pts: Point[], closed: boolean): number {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) d = Math.min(d, distToSegment(p, pts[i], pts[(i + 1) % n]));
  return d;
}

/** Vereinfacht eine Punktfolge (Ramer-Douglas-Peucker). */
export function simplify(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** Erzeugt eine Freihandform aus Seitenpunkten. */
export function freehandShape(pts: Point[], tol: number): Shape | null {
  const simple = simplify(pts, tol);
  if (simple.length < 3) return null;
  const xs = simple.map((p) => p.x);
  const ys = simple.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x || 1e-6;
  const h = Math.max(...ys) - y || 1e-6;
  return {
    type: 'freehand',
    x,
    y,
    w,
    h,
    points: simple.map((p) => [round6((p.x - x) / w), round6((p.y - y) / h)] as [number, number]),
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Pfad einer Form als Liste von Segmenten (Linien und kubische Bézierkurven). */
export type PathCmd =
  | { c: 'M'; p: Point }
  | { c: 'L'; p: Point }
  | { c: 'C'; p1: Point; p2: Point; p: Point }
  | { c: 'Z' };

export function shapePath(s: Shape): PathCmd[] {
  if (s.type === 'rect') {
    return [
      { c: 'M', p: { x: s.x, y: s.y } },
      { c: 'L', p: { x: s.x + s.w, y: s.y } },
      { c: 'L', p: { x: s.x + s.w, y: s.y + s.h } },
      { c: 'L', p: { x: s.x, y: s.y + s.h } },
      { c: 'Z' },
    ];
  }
  if (s.type === 'ellipse') {
    const k = 0.5522847498;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const rx = s.w / 2;
    const ry = s.h / 2;
    return [
      { c: 'M', p: { x: cx + rx, y: cy } },
      { c: 'C', p1: { x: cx + rx, y: cy + k * ry }, p2: { x: cx + k * rx, y: cy + ry }, p: { x: cx, y: cy + ry } },
      { c: 'C', p1: { x: cx - k * rx, y: cy + ry }, p2: { x: cx - rx, y: cy + k * ry }, p: { x: cx - rx, y: cy } },
      { c: 'C', p1: { x: cx - rx, y: cy - k * ry }, p2: { x: cx - k * rx, y: cy - ry }, p: { x: cx, y: cy - ry } },
      { c: 'C', p1: { x: cx + k * rx, y: cy - ry }, p2: { x: cx + rx, y: cy - k * ry }, p: { x: cx + rx, y: cy } },
      { c: 'Z' },
    ];
  }
  const pts = freehandPoints(s);
  return [...pts.map((p, i) => ({ c: i ? 'L' : 'M', p }) as PathCmd), { c: 'Z' }];
}

/** Wandelt Pfadsegmente mit einer Punktabbildung in einen SVG-Pfad-String um. */
export function pathToSvg(cmds: PathCmd[], map: (p: Point) => Point = (p) => p): string {
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  const pt = (p: Point) => {
    const q = map(p);
    return `${f(q.x)} ${f(q.y)}`;
  };
  return cmds
    .map((c) => {
      switch (c.c) {
        case 'M':
          return `M${pt(c.p)}`;
        case 'L':
          return `L${pt(c.p)}`;
        case 'C':
          return `C${pt(c.p1)} ${pt(c.p2)} ${pt(c.p)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

/** Ändert die Größe einer Form über einen Anfasser (nw, n, ne, e, se, s, sw, w). */
export function resizeShape(s: Shape, handle: string, p: Point, minSize: number): Shape {
  let x1 = s.x;
  let y1 = s.y;
  let x2 = s.x + s.w;
  let y2 = s.y + s.h;
  if (handle.includes('w')) x1 = Math.min(p.x, x2 - minSize);
  if (handle.includes('e')) x2 = Math.max(p.x, x1 + minSize);
  if (handle.includes('n')) y1 = Math.min(p.y, y2 - minSize);
  if (handle.includes('s')) y2 = Math.max(p.y, y1 + minSize);
  return { ...s, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export function handlePosition(r: Rect, h: string): Point {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Beschriftung

export interface LabelInput {
  id: string;
  bounds: Rect;
  /** Breite und Höhe des Beschriftungsfelds */
  w: number;
  h: number;
  /** manuelle Verschiebung relativ zur Standardposition */
  offset: { dx: number; dy: number } | null;
}

/**
 * Ordnet die Schadstellennummern neben den Markierungen an und vermeidet dabei
 * Überlappungen, soweit möglich. Funktioniert in beliebigen Koordinaten (Bildschirm
 * oder PDF), damit Ansicht und Export identisch beschriftet werden.
 * Gibt die linke obere Ecke jedes Beschriftungsfelds zurück.
 */
export function layoutLabels(items: LabelInput[], gap: number): Map<string, Rect> {
  const placed: Rect[] = [];
  const result = new Map<string, Rect>();
  // Manuell verschobene Beschriftungen zuerst – sie sind fest.
  const sorted = [...items].sort((a, b) => Number(!!b.offset) - Number(!!a.offset));
  for (const it of sorted) {
    const b = it.bounds;
    const defaultPos = { x: b.x + b.w + gap, y: b.y - it.h - gap };
    if (it.offset) {
      const r = { x: b.x + b.w + it.offset.dx, y: b.y + it.offset.dy - it.h, w: it.w, h: it.h };
      placed.push(r);
      result.set(it.id, r);
      continue;
    }
    const candidates: Point[] = [
      defaultPos, // oben rechts
      { x: b.x - it.w - gap, y: b.y - it.h - gap }, // oben links
      { x: b.x + b.w + gap, y: b.y + b.h + gap }, // unten rechts
      { x: b.x - it.w - gap, y: b.y + b.h + gap }, // unten links
      { x: b.x + b.w + gap, y: b.y + b.h / 2 - it.h / 2 }, // rechts
      { x: b.x - it.w - gap, y: b.y + b.h / 2 - it.h / 2 }, // links
      { x: b.x + b.w / 2 - it.w / 2, y: b.y - it.h - gap }, // oben
      { x: b.x + b.w / 2 - it.w / 2, y: b.y + b.h + gap }, // unten
    ];
    let chosen = candidates[0];
    for (const c of candidates) {
      const r = { x: c.x, y: c.y, w: it.w, h: it.h };
      if (!placed.some((q) => rectsOverlap(q, r))) {
        chosen = c;
        break;
      }
    }
    const r = { x: chosen.x, y: chosen.y, w: it.w, h: it.h };
    placed.push(r);
    result.set(it.id, r);
  }
  return result;
}

/** Ankerpunkt (für die Verbindungslinie) einer Beschriftung: nächstgelegener Punkt des Begrenzungsrechtecks. */
export function nearestPointOnRect(r: Rect, p: Point): Point {
  return { x: Math.max(r.x, Math.min(p.x, r.x + r.w)), y: Math.max(r.y, Math.min(p.y, r.y + r.h)) };
}
