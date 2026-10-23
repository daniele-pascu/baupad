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
  /** Form der Markierung – für eine genaue Verbindungslinie und Mehrdeutigkeitsprüfung */
  shape?: Shape;
  /** Breite und Höhe des Beschriftungsfelds */
  w: number;
  h: number;
  /** manuelle Verschiebung relativ zur Standardposition */
  offset: { dx: number; dy: number } | null;
}

export interface LabelOptions {
  /** Bereich, in dem die Beschriftungen liegen sollen (z. B. Planausschnitt) */
  area?: Rect;
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Abstand eines Punktes zu einem Rechteck (0, wenn innerhalb). */
export function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Abstand zwischen zwei Rechtecken (0, wenn sie sich berühren oder überlappen). */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Ordnet die Schadstellennummern so an, dass
 * 1. keine Nummer eine andere verdeckt,
 * 2. keine Nummer auf einer fremden Schadstelle liegt,
 * 3. jede Nummer eindeutig näher an ihrer eigenen Schadstelle steht als an einer anderen,
 * 4. die Nummer möglichst dicht an der Schadstelle steht (bevorzugt oben rechts).
 *
 * Jede mögliche Position wird bewertet; gewählt wird die beste. Eng beieinander liegende
 * Schadstellen werden zuerst platziert, danach wird zweimal nachgebessert.
 * Funktioniert in beliebigen Koordinaten (Bildschirm oder PDF), damit Ansicht und Export
 * gleich beschriftet werden. Gibt das Beschriftungsfeld jeder Schadstelle zurück.
 */
export function layoutLabels(items: LabelInput[], gap: number, opts: LabelOptions = {}): Map<string, Rect> {
  const result = new Map<string, Rect>();
  if (!items.length) return result;
  const maxH = Math.max(...items.map((i) => i.h));
  const reach = maxH * 6 + gap * 4;

  // Nachbarn je Schadstelle (nur diese können sich gegenseitig stören)
  const neighbours = items.map((a) =>
    items.filter((b) => b !== a && rectGap(a.bounds, b.bounds) <= reach * 2 + Math.max(a.w, b.w) * 2),
  );
  const indexOf = new Map(items.map((it, i) => [it, i]));

  // Manuell verschobene Beschriftungen sind fest
  for (const it of items) {
    if (!it.offset) continue;
    const b = it.bounds;
    result.set(it.id, { x: b.x + b.w + it.offset.dx, y: b.y + it.offset.dy - it.h, w: it.w, h: it.h });
  }

  const candidates = (it: LabelInput): { r: Rect; pref: number; inside: boolean }[] => {
    const b = it.bounds;
    const { w, h } = it;
    const list: { r: Rect; pref: number; inside: boolean }[] = [];
    const rings = [gap, gap + h * 0.9, gap + h * 2, gap + h * 3.5, gap + h * 5.5];
    rings.forEach((d, ring) => {
      const pos: [number, number, number][] = [
        [b.x + b.w + d, b.y - h - d, 0], // oben rechts
        [b.x - w - d, b.y - h - d, 1], // oben links
        [b.x + b.w + d, b.y + b.h + d, 1.4], // unten rechts
        [b.x - w - d, b.y + b.h + d, 1.8], // unten links
        [b.x + b.w + d, b.y + b.h / 2 - h / 2, 1.2], // rechts
        [b.x - w - d, b.y + b.h / 2 - h / 2, 1.6], // links
        [b.x + b.w / 2 - w / 2, b.y - h - d, 1.3], // oben
        [b.x + b.w / 2 - w / 2, b.y + b.h + d, 1.9], // unten
        [b.x + b.w + d, b.y, 0.8], // rechts, oben bündig
        [b.x + b.w - w, b.y - h - d, 0.6], // oben, rechts bündig
      ];
      for (const [x, y, p] of pos) list.push({ r: { x, y, w, h }, pref: p + ring * 4, inside: false });
    });
    // Innerhalb großer Markierungen ist die Zuordnung eindeutig
    if (b.w >= w * 1.8 && b.h >= h * 1.8) {
      list.push({ r: { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }, pref: 2.5, inside: true });
    }
    return list;
  };

  const score = (it: LabelInput, c: { r: Rect; pref: number; inside: boolean }, others: LabelInput[]): number => {
    const r = c.r;
    const la = r.w * r.h;
    let s = c.pref;
    const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    // 1. andere Nummern verdecken: praktisch ausgeschlossen
    for (const o of others) {
      const q = result.get(o.id);
      if (q) {
        const ov = overlapArea(r, q);
        if (ov > 0) s += 10000 + (ov / la) * 10000;
      }
    }
    // 2. fremde Schadstellen verdecken
    let nearestOther = Infinity;
    for (const o of others) {
      const ov = overlapArea(r, o.bounds);
      if (ov > 0) s += 600 + (ov / la) * 600;
      nearestOther = Math.min(nearestOther, distToRect(center, o.bounds));
    }
    // eigene Schadstelle nicht verdecken (außer bewusst innerhalb)
    if (!c.inside) {
      const ov = overlapArea(r, it.bounds);
      if (ov > 0) s += 40 + (ov / la) * 200;
    }
    // 3. Eindeutigkeit: Nummer muss deutlich näher an der eigenen Schadstelle stehen
    const own = distToRect(center, it.bounds);
    if (nearestOther < Infinity) {
      if (nearestOther <= own) s += 400;
      else if (nearestOther < own + it.h) s += 80 * (1 - (nearestOther - own) / it.h);
    }
    // Bereich verlassen (z. B. außerhalb des Planausschnitts)
    if (opts.area) {
      const a = opts.area;
      const inside = overlapArea(r, a);
      if (inside < la) s += 300 * (1 - inside / la);
    }
    return s;
  };

  const auto = items.filter((i) => !i.offset);
  // Eng beieinander liegende Schadstellen zuerst
  const crowd = (it: LabelInput) =>
    neighbours[indexOf.get(it)!].filter((o) => rectGap(it.bounds, o.bounds) <= reach).length;
  const order = [...auto].sort((a, b) => crowd(b) - crowd(a) || a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h);

  const place = (it: LabelInput) => {
    const others = neighbours[indexOf.get(it)!];
    let best: Rect | null = null;
    let bestScore = Infinity;
    for (const c of candidates(it)) {
      const sc = score(it, c, others);
      if (sc < bestScore) {
        bestScore = sc;
        best = c.r;
      }
    }
    result.set(it.id, best!);
  };

  for (const it of order) place(it);
  // Nachbessern: jede Nummer mit Kenntnis aller anderen neu platzieren
  for (let pass = 0; pass < 2; pass++) {
    for (const it of order) {
      result.delete(it.id);
      place(it);
    }
  }
  return result;
}

/** Punkt auf dem Umriss einer Form, der dem Punkt `p` am nächsten liegt (Ellipse: Richtung zum Mittelpunkt). */
export function outlinePointToward(shape: Shape, p: Point): Point {
  const b = shapeBounds(shape);
  if (shape.type === 'ellipse') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const a = Math.atan2((p.y - cy) / (b.h / 2 || 1), (p.x - cx) / (b.w / 2 || 1));
    return { x: cx + (b.w / 2) * Math.cos(a), y: cy + (b.h / 2) * Math.sin(a) };
  }
  if (shape.type === 'freehand') {
    const pts = freehandPoints(shape);
    let best = pts[0] ?? p;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }
  return nearestPointOnRect(b, p);
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Verbindungslinie zwischen Beschriftung und Markierung, wenn die Nummer nicht direkt am
 * Umriss steht. Gemessen wird zum tatsächlichen Umriss (Kreis, Freihand, Rechteck) –
 * nicht zum umgebenden Rechteck, sonst fehlt die Linie z. B. an der Ecke eines Kreises.
 */
export function leaderLine(shape: Shape, label: Rect, minGap: number): { from: Point; to: Point } | null {
  const lc = { x: label.x + label.w / 2, y: label.y + label.h / 2 };
  const to = outlinePointToward(shape, lc);
  const from = nearestPointOnRect(label, to);
  if (Math.hypot(from.x - to.x, from.y - to.y) <= minGap) return null;
  return { from, to };
}

/** Ankerpunkt (für die Verbindungslinie) einer Beschriftung: nächstgelegener Punkt des Begrenzungsrechtecks. */
export function nearestPointOnRect(r: Rect, p: Point): Point {
  return { x: Math.max(r.x, Math.min(p.x, r.x + r.w)), y: Math.max(r.y, Math.min(p.y, r.y + r.h)) };
}
