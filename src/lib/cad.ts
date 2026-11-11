import { distToSegment, isOpenShape, lineShape, shapeCenter, shapeVertices, shapeFromVertices, type Point } from './geometry';
import { edgesOf, segmentIntersection } from './snap';
import type { Rect, Shape } from './types';

/**
 * Bearbeitungsbefehle wie in CAD-Programmen (Kopieren/Verschieben per Vektor, Drehen,
 * Skalieren, Strecken, Trimmen, Verlängern) und der Bogen aus drei Punkten. Alle Funktionen
 * arbeiten auf der gespeicherten Geometrie (gleiche Einheit für Ein- und Ausgabe).
 */

/** Form um einen Vektor verschieben (für Kopieren und Verschieben) */
export const translateShape = (s: Shape, dx: number, dy: number): Shape => ({ ...s, x: s.x + dx, y: s.y + dy });

/** Form um ihren Mittelpunkt drehen (Grad, im Uhrzeigersinn wie am Bildschirm) */
export function rotateShapeBy(s: Shape, deg: number): Shape {
  const r = ((((s.rotation ?? 0) + deg) % 360) + 360) % 360;
  return { ...s, rotation: r || undefined };
}

/** Form um ihren Mittelpunkt skalieren (Faktor > 0) – Proportionen bleiben erhalten */
export function scaleShape(s: Shape, f: number): Shape {
  const c = shapeCenter(s);
  return { ...s, x: c.x - (s.w * f) / 2, y: c.y - (s.h * f) / 2, w: s.w * f, h: s.h * f };
}

const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Strecken: Eckpunkte innerhalb des Fensters um (dx, dy) verschieben, alle anderen bleiben.
 * Liegen alle Punkte im Fenster, wird die Form verschoben. Kreise werden nur verschoben,
 * wenn sie ganz im Fenster liegen. null = Form nicht betroffen.
 */
export function stretchShape(s: Shape, win: Rect, dx: number, dy: number): Shape | null {
  if (s.type === 'ellipse') {
    const corners = shapeVertices({ ...s, type: 'rect' });
    return corners.every((p) => inside(p, win)) ? translateShape(s, dx, dy) : null;
  }
  const pts = shapeVertices(s);
  const hit = pts.map((p) => inside(p, win));
  if (!hit.some(Boolean)) return null;
  if (hit.every(Boolean)) return translateShape(s, dx, dy);
  const moved = pts.map((p, i) => (hit[i] ? { x: p.x + dx, y: p.y + dy } : p));
  if (s.type === 'line') return lineShape(moved[0], moved[1]);
  return shapeFromVertices(s, moved);
}

/** Endpunkte einer Linie */
const ends = (s: Shape): [Point, Point] => {
  const v = shapeVertices(s);
  return [v[0], v[v.length - 1]];
};

/** Parameter t (0 = Anfang, 1 = Ende) der Schnittpunkte einer Linie mit anderen Formen */
function cutParams(a: Point, b: Point, others: Shape[], infinite: boolean): number[] {
  const far = infinite ? 1e6 : 1;
  const A = { x: a.x - (b.x - a.x) * (far - 1), y: a.y - (b.y - a.y) * (far - 1) };
  const B = { x: a.x + (b.x - a.x) * far, y: a.y + (b.y - a.y) * far };
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const ts: number[] = [];
  for (const o of others) {
    for (const seg of edgesOf(o)) {
      const x = segmentIntersection([A, B], seg);
      if (x) ts.push(((x.x - a.x) * (b.x - a.x) + (x.y - a.y) * (b.y - a.y)) / len2);
    }
  }
  return ts;
}

/**
 * Trimmen: Den angeklickten Abschnitt einer Linie zwischen zwei Schnittpunkten (bzw. bis zum
 * Linienende) entfernen. Ergebnis: 0, 1 oder 2 verbleibende Linien; null = keine Schnittpunkte.
 */
export function trimLine(line: Shape, click: Point, others: Shape[]): Shape[] | null {
  const [a, b] = ends(line);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!len2) return null;
  const ts = cutParams(a, b, others, false).filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y);
  if (!ts.length) return null;
  const tc = Math.min(1, Math.max(0, ((click.x - a.x) * (b.x - a.x) + (click.y - a.y) * (b.y - a.y)) / len2));
  const lo = [0, ...ts].filter((t) => t <= tc).pop()!;
  const hi = [...ts, 1].find((t) => t >= tc)!;
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const out: Shape[] = [];
  if (lo > 1e-6) out.push(lineShape(a, at(lo)));
  if (hi < 1 - 1e-6) out.push(lineShape(at(hi), b));
  return out;
}

/** Punkt auf einem Linienzug an der Bogenlänge d (Segmente mit kumulierten Anfangslängen) */
function pathPoint(segs: [Point, Point][], starts: number[], d: number): Point {
  let i = 0;
  while (i < segs.length - 1 && starts[i + 1] <= d) i++;
  const [a, b] = segs[i];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.min(1, Math.max(0, (d - starts[i]) / len));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Teilstück [d1, d2] eines Linienzugs als Punktfolge (d2 > d1; bei geschlossenen Zügen über das Ende hinaus) */
function subPath(segs: [Point, Point][], starts: number[], total: number, d1: number, d2: number, closed: boolean): Point[] {
  const out: Point[] = [];
  const at = (d: number) => pathPoint(segs, starts, closed ? ((d % total) + total) % total : d);
  out.push(at(d1));
  // Eckpunkte zwischen d1 und d2 (bei geschlossenen Zügen auch in der nächsten Runde)
  const laps = closed ? [0, total] : [0];
  for (const lap of laps) {
    for (let i = 0; i < segs.length; i++) {
      const v = starts[i] + lap;
      if (v > d1 + 1e-9 && v < d2 - 1e-9) out.push(segs[i][0]);
    }
  }
  out.push(at(d2));
  return out;
}

const TRIM_EPS = 1e-6;

/**
 * Stutzen (wie „Trimmen“ im CAD, Schnellmodus): Den angeklickten Abschnitt einer beliebigen Form
 * (Linie, Polylinie, Rechteck, Dreieck, Kreis, Bogen) zwischen den beiden nächsten Schnittpunkten
 * mit anderen Formen entfernen – liegt auf einer Seite kein Schnittpunkt, bis zum Linienende.
 * Ergebnis: verbleibende offene Linienzüge (leer = ganze Form entfernt); null = nichts zu stutzen
 * (keine Schnittpunkte bzw. bei geschlossenen Formen weniger als zwei).
 */
export function trimShape(shape: Shape, click: Point, others: Shape[]): Shape[] | null {
  const segs = edgesOf(shape) as [Point, Point][];
  if (!segs.length) return null;
  const closed = shape.type === 'ellipse' || !isOpenShape(shape);
  const starts: number[] = [];
  let total = 0;
  for (const [a, b] of segs) {
    starts.push(total);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (total < TRIM_EPS) return null;
  // Schnittpunkte als Bogenlänge entlang der Form
  const cuts: number[] = [];
  segs.forEach(([a, b], i) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) return;
    for (const o of others) {
      for (const e of edgesOf(o)) {
        const x = segmentIntersection([a, b], e);
        if (x) cuts.push(starts[i] + Math.hypot(x.x - a.x, x.y - a.y));
      }
    }
  });
  // Eckpunkte der Form selbst sind ebenfalls Grenzen: bei Rechteck, Dreieck, Polylinie wird nur das Stück
  // von Punkt zu Punkt entfernt (z. B. beim Quadrat A–D nur die Seite B–C). Nicht bei Kreisen und Bögen bzw.
  // Freihand-Linien mit sehr vielen Punkten (dort sind die Eckpunkte nur Näherung).
  const polygonal = shape.type !== 'ellipse' && segs.length <= 24;
  if (polygonal) for (let i = closed ? 0 : 1; i < segs.length; i++) cuts.push(starts[i]);
  const uniq = cuts
    .map((d) => (closed ? ((d % total) + total) % total : d))
    .filter((d) => closed || (d > TRIM_EPS && d < total - TRIM_EPS))
    .sort((x, y) => x - y)
    .filter((d, i, arr) => i === 0 || d - arr[i - 1] > TRIM_EPS);
  if (closed && uniq.length > 1 && total - uniq[uniq.length - 1] + uniq[0] <= TRIM_EPS) uniq.pop();
  if (!uniq.length || (closed && uniq.length < 2)) return null;
  // Klickstelle als Bogenlänge (nächster Punkt auf der Form)
  let dc = 0;
  let best = Infinity;
  segs.forEach(([a, b], i) => {
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2 ? Math.min(1, Math.max(0, ((click.x - a.x) * (b.x - a.x) + (click.y - a.y) * (b.y - a.y)) / len2)) : 0;
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = Math.hypot(click.x - q.x, click.y - q.y);
    if (d < best) {
      best = d;
      dc = starts[i] + Math.sqrt(len2) * t;
    }
  });
  const piece = (pts: Point[]): Shape =>
    pts.length === 2 ? lineShape(pts[0], pts[1]) : shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed: false }, pts);
  if (closed) {
    // genau auf einer Grenze (z. B. Eckpunkt): die beiden angrenzenden Stücke zählen
    const lo = uniq.filter((d) => d < dc - TRIM_EPS).pop() ?? uniq[uniq.length - 1] - total;
    const hi = uniq.find((d) => d > dc + TRIM_EPS) ?? uniq[0] + total;
    // alles entfernt (nur ein Abschnitt übrig wäre leer)
    if (hi - lo >= total - TRIM_EPS) return [];
    // Rest: vom oberen Schnittpunkt einmal herum bis zum unteren
    return [piece(subPath(segs, starts, total, hi, lo + total, true))];
  }
  const lo = [0, ...uniq].filter((d) => d < dc - TRIM_EPS).pop() ?? 0;
  const hi = [...uniq, total].find((d) => d > dc + TRIM_EPS) ?? total;
  const out: Shape[] = [];
  if (lo > TRIM_EPS) out.push(piece(subPath(segs, starts, total, 0, lo, false)));
  if (hi < total - TRIM_EPS) out.push(piece(subPath(segs, starts, total, hi, total, false)));
  return out;
}

/** Schnittpunkte eines Zauns (Linienzug, z. B. frei gezogen) mit einer Form */
export function fenceHits(shape: Shape, path: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    for (const e of edgesOf(shape)) {
      const x = segmentIntersection([path[i - 1], path[i]], e);
      if (x && !out.some((q) => Math.hypot(q.x - x.x, q.y - x.y) < TRIM_EPS)) out.push(x);
    }
  }
  return out;
}

/**
 * Stutzen mit Zaun: Jede Form, die der gezogene Zaun kreuzt, wird an jeder Kreuzungsstelle
 * gestutzt (wie mehrfaches Anklicken). Der Zaun ist eine Strecke oder ein frei gezogener Linienzug
 * (z. B. über mehrere nicht parallele Linien). Schnittkanten sind alle übrigen Formen im Ausgangszustand.
 * Ergebnis je betroffener Form (Index in shapes): verbleibende Teile.
 */
export function trimByFence(shapes: Shape[], fence: Point[] | Point, b?: Point): Map<number, Shape[]> {
  const path = Array.isArray(fence) ? fence : [fence, b!];
  const result = new Map<number, Shape[]>();
  shapes.forEach((s, i) => {
    const hits = fenceHits(s, path);
    if (!hits.length) return;
    const others = shapes.filter((_, j) => j !== i);
    let parts: Shape[] = [s];
    let changed = false;
    for (const h of hits) {
      // Teilstück, auf dem die Kreuzung liegt
      const idx = parts.findIndex((p) => edgesOf(p).some(([u, v]) => distToSegment(h, u, v) < 1e-6));
      if (idx < 0) continue;
      const next = trimShape(parts[idx], h, others);
      if (!next) continue;
      parts = [...parts.slice(0, idx), ...next, ...parts.slice(idx + 1)];
      changed = true;
    }
    if (changed) result.set(i, parts);
  });
  return result;
}

/**
 * Verlängern: Das Linienende, das dem Klick näher liegt, bis zur nächsten Form in
 * Linienrichtung verlängern. null = keine Form in dieser Richtung.
 */
export function extendLine(line: Shape, click: Point, others: Shape[]): Shape | null {
  const [a, b] = ends(line);
  const nearB = Math.hypot(click.x - b.x, click.y - b.y) <= Math.hypot(click.x - a.x, click.y - a.y);
  const ts = cutParams(a, b, others, true);
  const eps = 1e-6;
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (nearB) {
    const t = ts.filter((x) => x > 1 + eps).sort((x, y) => x - y)[0];
    return t === undefined ? null : lineShape(a, at(t));
  }
  const t = ts.filter((x) => x < -eps).sort((x, y) => y - x)[0];
  return t === undefined ? null : lineShape(at(t), b);
}

/** Kreis durch drei Punkte (null, wenn sie auf einer Geraden liegen) */
export function circleThrough(p1: Point, p2: Point, p3: Point): { c: Point; r: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-12) return null;
  const s1 = p1.x ** 2 + p1.y ** 2;
  const s2 = p2.x ** 2 + p2.y ** 2;
  const s3 = p3.x ** 2 + p3.y ** 2;
  const c = { x: (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d, y: (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d };
  return { c, r: Math.hypot(p1.x - c.x, p1.y - c.y) };
}

/** Segmente, mit denen ein Bogen dargestellt wird (Länge weicht < 0,1 % vom echten Bogen ab) */
export const ARC_SEGMENTS = 48;

/**
 * Bogen von p1 über p2 nach p3 als offene Punktfolge (fein unterteilt). null, wenn die drei
 * Punkte auf einer Geraden liegen.
 */
export function arcShape(p1: Point, p2: Point, p3: Point): Shape | null {
  const k = circleThrough(p1, p2, p3);
  if (!k) return null;
  const ang = (p: Point) => Math.atan2(p.y - k.c.y, p.x - k.c.x);
  const a1 = ang(p1);
  const a3 = ang(p3);
  const a2 = ang(p2);
  // Drehrichtung so wählen, dass der Bogen durch p2 läuft
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(a2 - a1) < norm(a3 - a1);
  let sweep = ccw ? norm(a3 - a1) : -norm(a1 - a3);
  if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI;
  const pts = Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
    const a = a1 + (sweep * i) / ARC_SEGMENTS;
    return { x: k.c.x + Math.cos(a) * k.r, y: k.c.y + Math.sin(a) * k.r };
  });
  return shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed: false }, pts);
}

/** Radius eines gespeicherten Bogens (aus Anfangs-, Mittel- und Endpunkt) */
export function arcRadius(s: Shape): number | null {
  const v = shapeVertices(s);
  if (v.length < 3) return null;
  return circleThrough(v[0], v[Math.floor(v.length / 2)], v[v.length - 1])?.r ?? null;
}

/** 90°-Modus: automatisch (größere Bewegungsrichtung), nur waagrecht oder nur senkrecht */
export type OrthoDir = 'auto' | 'h' | 'v';
export const ORTHO_DIRS: OrthoDir[] = ['auto', 'h', 'v'];

/**
 * Orthogonalpunkt: `to` waagrecht bzw. senkrecht zu `from` ausgerichtet (Plankoordinaten,
 * unabhängig von Zoom und Verschiebung).
 */
export function orthoPoint(from: Point, to: Point, dir: OrthoDir = 'auto'): Point {
  const horiz = dir === 'h' || (dir === 'auto' && Math.abs(to.x - from.x) >= Math.abs(to.y - from.y));
  return horiz ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}
