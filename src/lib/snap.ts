import { isOpenShape, shapeCenter, shapeVertices, type Point } from './geometry';
import type { PlanSeg } from './pdf-snap';
import type { Shape } from './types';

/**
 * Punktfang (wie in CAD-Programmen): End-/Eckpunkte, Schnittpunkte, Mittelpunkte, Kreismitte
 * und der nächstgelegene Punkt auf einer Linie. Gerechnet wird in Plankoordinaten – die
 * Genauigkeit hängt nicht vom Zoom ab; nur der Fangradius wird in Bildschirmpixeln gewählt.
 */

export type SnapKind = 'end' | 'intersection' | 'mid' | 'center' | 'quadrant' | 'perpendicular' | 'tangent' | 'nearest' | 'parallel' | 'square' | 'grid' | 'track';

export const SNAP_LABELS: Record<SnapKind, string> = {
  end: 'Endpunkt',
  intersection: 'Schnittpunkt',
  mid: 'Mittelpunkt',
  center: 'Mittelpunkt (Kreis)',
  quadrant: 'Quadrant',
  perpendicular: 'Lotpunkt',
  tangent: 'Tangente',
  nearest: 'Auf Linie',
  parallel: 'Parallel',
  square: 'Rechtwinklig',
  grid: 'Raster',
  track: 'Spurlinie',
};

/**
 * Objektfang-Arten, die man ein- und ausschalten und in der Rangfolge ordnen kann (Standard-Reihenfolge).
 * „parallel“ steht für Parallel und Rechtwinklig zu einer angefahrenen Linie.
 */
export const OBJECT_SNAPS: SnapKind[] = ['end', 'intersection', 'mid', 'center', 'quadrant', 'perpendicular', 'tangent', 'nearest', 'parallel'];
export const OBJECT_SNAP_INFO: Partial<Record<SnapKind, string>> = {
  end: 'Endpunkt / Ecke',
  intersection: 'Schnittpunkt',
  mid: 'Mittelpunkt einer Kante',
  center: 'Mitte von Kreis und Bogen',
  quadrant: 'Quadrant (0°/90°/180°/270° am Kreis)',
  perpendicular: 'Lotpunkt (rechtwinklig auf Linie bzw. Kreis)',
  tangent: 'Tangente an Kreis bzw. Bogen',
  nearest: 'Nächster Punkt auf Linie',
  parallel: 'Parallel / rechtwinklig zu angefahrener Linie',
};

/** gespeicherte Auswahl (Reihenfolge = Vorrang) bereinigen: unbekannte weg, neue Arten hinten anhängen (ein) */
export function normalizeSnapKinds(order: unknown, enabled: unknown): { order: SnapKind[]; enabled: SnapKind[] } {
  const o = Array.isArray(order) ? (order.filter((k) => OBJECT_SNAPS.includes(k as SnapKind)) as SnapKind[]) : [];
  const missing = OBJECT_SNAPS.filter((k) => !o.includes(k));
  const fullOrder = [...new Set([...o, ...missing])];
  const en = Array.isArray(enabled) ? (enabled.filter((k) => OBJECT_SNAPS.includes(k as SnapKind)) as SnapKind[]) : OBJECT_SNAPS;
  return { order: fullOrder, enabled: [...new Set([...en, ...(Array.isArray(order) ? missing : [])])] };
}

export interface SnapHit {
  point: Point;
  kind: SnapKind;
  /** „Auf Linie“: die getroffene Kante (für Parallel/Rechtwinklig) */
  seg?: Seg;
}

export interface SnapOptions {
  /** eingeschaltete Fangarten in Vorrang-Reihenfolge (fehlt = alle in Standard-Reihenfolge) */
  kinds?: SnapKind[];
  /** letzter Punkt (für Lotpunkt und Tangente) */
  from?: Point | null;
  /** Kreise und Bögen: Mitte und Radius (Bögen sind als Polylinie gespeichert) */
  circles?: { c: Point; r: number }[];
  /** zusätzliche (sehr lange) Linien, z. B. Hilfslinien – Schnittpunkte und „auf Linie“ */
  lines?: Seg[];
}

type Seg = [Point, Point];
export type { Seg as SnapSeg };

/** Kanten einer Form (Kreise fein angenähert, nur für Schnitt- und Linienpunkte) */
export function edgesOf(s: Shape): Seg[] {
  let pts: Point[];
  let closed: boolean;
  if (s.type === 'ellipse') {
    const c = shapeCenter(s);
    const rot = ((s.rotation ?? 0) * Math.PI) / 180;
    pts = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      const x = (Math.cos(a) * s.w) / 2;
      const y = (Math.sin(a) * s.h) / 2;
      return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
    });
    closed = true;
  } else {
    pts = shapeVertices(s);
    closed = !isOpenShape(s);
  }
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
}

/** Fangpunkte einer Form ohne Schnittpunkte */
function pointsOf(s: Shape): SnapHit[] {
  if (s.type === 'ellipse') {
    const c = shapeCenter(s);
    const rot = ((s.rotation ?? 0) * Math.PI) / 180;
    const q = [
      { x: s.w / 2, y: 0 },
      { x: 0, y: s.h / 2 },
      { x: -s.w / 2, y: 0 },
      { x: 0, y: -s.h / 2 },
    ].map((p) => ({ x: c.x + p.x * Math.cos(rot) - p.y * Math.sin(rot), y: c.y + p.x * Math.sin(rot) + p.y * Math.cos(rot) }));
    return [{ point: c, kind: 'center' }, ...q.map((point) => ({ point, kind: 'quadrant' as const }))];
  }
  const hits: SnapHit[] = shapeVertices(s).map((point) => ({ point, kind: 'end' }));
  for (const [a, b] of edgesOf(s)) hits.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: 'mid' });
  return hits;
}

/** Schnittpunkt zweier Strecken (null, wenn parallel oder außerhalb) */
export function segmentIntersection([a, b]: Seg, [c, d]: Seg): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

function nearestOnSeg(p: Point, [a, b]: Seg): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

const samePt = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const sharesEnd = ([a, b]: Seg, [c, d]: Seg) => samePt(a, c) || samePt(a, d) || samePt(b, c) || samePt(b, d);

const segNear = ([a, b]: Seg, p: Point, tol: number) =>
  p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;

/**
 * Bester Fangpunkt im Radius `tol` (Plankoordinaten) um `p`. Bei mehreren Treffern gewinnt
 * die Art mit höherem Rang (Endpunkt vor Schnittpunkt vor Mittelpunkt …), dann der nähere.
 * `planSegs`: Linien des PDF-Plans in der Nähe (Ecken, Mittelpunkte, Schnittpunkte, auf Linie).
 */
export function findSnap(p: Point, shapes: Shape[], tol: number, planSegs: PlanSeg[] = [], opts: SnapOptions = {}): SnapHit | null {
  const kinds = opts.kinds ?? OBJECT_SNAPS;
  const rank = (k: SnapKind) => kinds.indexOf(k);
  const cands: SnapHit[] = [];
  for (const s of shapes) cands.push(...pointsOf(s));
  // Bögen: Mitte (Kreise liefern ihre Mitte schon über pointsOf)
  for (const { c } of opts.circles ?? []) cands.push({ point: c, kind: 'center' });
  const circles = [...(opts.circles ?? [])];
  for (const s of shapes)
    if (s.type === 'ellipse' && Math.abs(s.w - s.h) < 1e-9) circles.push({ c: shapeCenter(s), r: s.w / 2 });
  const from = opts.from;
  for (const { c, r } of circles) {
    if (!from || r < 1e-9) continue;
    const d = Math.hypot(from.x - c.x, from.y - c.y);
    if (d < 1e-9) continue;
    const ux = (from.x - c.x) / d;
    const uy = (from.y - c.y) / d;
    // Lotpunkt: auf dem Kreis in Richtung des letzten Punkts (bzw. gegenüber)
    cands.push({ point: { x: c.x + ux * r, y: c.y + uy * r }, kind: 'perpendicular' }, { point: { x: c.x - ux * r, y: c.y - uy * r }, kind: 'perpendicular' });
    // Tangente vom letzten Punkt (außerhalb des Kreises)
    if (d > r + 1e-9) {
      const a = Math.acos(r / d);
      const base = Math.atan2(uy, ux);
      for (const t of [base + a, base - a]) cands.push({ point: { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r }, kind: 'tangent' });
    }
  }
  // Kanten in der Nähe: Schnittpunkte (auch innerhalb einer Form) und nächster Punkt auf der Linie
  const near: { seg: Seg; owner: number; index: number }[] = [];
  shapes.forEach((s, owner) => edgesOf(s).forEach((seg, index) => segNear(seg, p, tol) && near.push({ seg, owner, index })));
  for (const s of planSegs) {
    if (s.ends & 1) cands.push({ point: s.a, kind: 'end' });
    if (s.ends & 2) cands.push({ point: s.b, kind: 'end' });
    if (s.straight) cands.push({ point: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, kind: 'mid' });
    near.push({ seg: [s.a, s.b], owner: shapes.length + s.path, index: s.index });
  }
  (opts.lines ?? []).forEach((seg, i) => near.push({ seg, owner: -1 - i, index: 0 }));
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const A = near[i];
      const B = near[j];
      if (A.owner === B.owner && Math.abs(A.index - B.index) <= 1) continue; // benachbarte Kanten treffen sich in einer Ecke
      // gezeichnete Formen: erste/letzte Kante treffen sich in einer Ecke (Ecken liefert pointsOf; beim Kreis wäre es kein Schnittpunkt).
      // PDF-Linien bleiben wie bisher – dort sind solche Ecken nur als Schnittpunkt fangbar.
      if (A.owner === B.owner && A.owner >= 0 && A.owner < shapes.length && sharesEnd(A.seg, B.seg)) continue;
      const x = segmentIntersection(A.seg, B.seg);
      if (x) cands.push({ point: x, kind: 'intersection' });
    }
    cands.push({ point: nearestOnSeg(p, near[i].seg), kind: 'nearest', seg: near[i].seg });
    // Lotpunkt vom letzten Punkt auf diese Kante (nur innerhalb der Kante)
    if (from) {
      const [a, b] = near[i].seg;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? ((from.x - a.x) * dx + (from.y - a.y) * dy) / l2 : -1;
      if (t >= -1e-9 && t <= 1 + 1e-9) cands.push({ point: { x: a.x + t * dx, y: a.y + t * dy }, kind: 'perpendicular' });
    }
  }
  let best: SnapHit | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    if (rank(c.kind) < 0) continue;
    const d = Math.hypot(c.point.x - p.x, c.point.y - p.y);
    if (d > tol) continue;
    if (!best || rank(c.kind) < rank(best.kind) || (rank(c.kind) === rank(best.kind) && d < bestD)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
