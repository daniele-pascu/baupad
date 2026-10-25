import { isOpenShape, shapeCenter, shapeVertices, type Point } from './geometry';
import type { Shape } from './types';

/**
 * Punktfang (wie in CAD-Programmen): End-/Eckpunkte, Schnittpunkte, Mittelpunkte, Kreismitte
 * und der nächstgelegene Punkt auf einer Linie. Gerechnet wird in Plankoordinaten – die
 * Genauigkeit hängt nicht vom Zoom ab; nur der Fangradius wird in Bildschirmpixeln gewählt.
 */

export type SnapKind = 'end' | 'intersection' | 'mid' | 'center' | 'nearest' | 'grid';

export const SNAP_LABELS: Record<SnapKind, string> = {
  end: 'Endpunkt',
  intersection: 'Schnittpunkt',
  mid: 'Mittelpunkt',
  center: 'Mittelpunkt (Kreis)',
  nearest: 'Auf Linie',
  grid: 'Raster',
};

export interface SnapHit {
  point: Point;
  kind: SnapKind;
}

/** Rangfolge bei mehreren Treffern im Fangradius: eindeutige Punkte vor „auf Linie“ */
const RANK: Record<SnapKind, number> = { end: 0, intersection: 1, mid: 2, center: 3, nearest: 4, grid: 5 };

type Seg = [Point, Point];

/** Kanten einer Form (Kreise fein angenähert, nur für Schnitt- und Linienpunkte) */
function edgesOf(s: Shape): Seg[] {
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
    return [{ point: c, kind: 'center' }, ...q.map((point) => ({ point, kind: 'end' as const }))];
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

const segNear = ([a, b]: Seg, p: Point, tol: number) =>
  p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;

/**
 * Bester Fangpunkt im Radius `tol` (Plankoordinaten) um `p`. Bei mehreren Treffern gewinnt
 * die Art mit höherem Rang (Endpunkt vor Schnittpunkt vor Mittelpunkt …), dann der nähere.
 */
export function findSnap(p: Point, shapes: Shape[], tol: number): SnapHit | null {
  const cands: SnapHit[] = [];
  for (const s of shapes) cands.push(...pointsOf(s));
  // Kanten in der Nähe: Schnittpunkte (auch innerhalb einer Form) und nächster Punkt auf der Linie
  const near: { seg: Seg; owner: number; index: number }[] = [];
  shapes.forEach((s, owner) => edgesOf(s).forEach((seg, index) => segNear(seg, p, tol) && near.push({ seg, owner, index })));
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const A = near[i];
      const B = near[j];
      if (A.owner === B.owner && Math.abs(A.index - B.index) <= 1) continue; // benachbarte Kanten treffen sich in einer Ecke
      const x = segmentIntersection(A.seg, B.seg);
      if (x) cands.push({ point: x, kind: 'intersection' });
    }
    cands.push({ point: nearestOnSeg(p, near[i].seg), kind: 'nearest' });
  }
  let best: SnapHit | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.point.x - p.x, c.point.y - p.y);
    if (d > tol) continue;
    if (!best || RANK[c.kind] < RANK[best.kind] || (RANK[c.kind] === RANK[best.kind] && d < bestD)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
