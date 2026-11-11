import { distanceToPolyline, isOpenShape, lineShape, pointInPolygon, polygonArea, polygonShape, shapeCenter, shapeFromVertices, shapeVertices, type Point } from './geometry';
import type { Shape } from './types';

/**
 * CAD-Befehle Verbinden, Versetzen und Spiegeln (Phase 2). Alle Punkte in derselben Einheit wie die Formen
 * (im Zeichenmodus Meter). Die Ergebnisse sind echte Geometrie: verbundene Linien sind eine einzige Polylinie,
 * geschlossene Konturen eine Fläche (Füllung, Schraffur, Fläche/Umfang).
 */

const EPS = 1e-9;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/* ───────────── Spiegeln ───────────── */

/** Punkt an der Geraden a–b spiegeln */
export function reflectPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || EPS;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

const normDeg = (d: number) => {
  const r = ((d % 360) + 360) % 360;
  return Math.abs(r) < 1e-9 || Math.abs(r - 360) < 1e-9 ? 0 : r;
};

/**
 * Form an der Achse a–b spiegeln (exakt, ohne Verzerrung). Rechteck und Kreis bleiben Rechteck/Kreis
 * (gespiegelte Drehung), Linien und Polylinien werden Punkt für Punkt gespiegelt.
 * readable: Lage spiegeln, Ausrichtung behalten (Text bleibt lesbar).
 */
export function mirrorShape(s: Shape, a: Point, b: Point, readable = false): Shape {
  if (s.type === 'rect' || s.type === 'ellipse' || readable) {
    const c = reflectPoint(shapeCenter(s), a, b);
    const axis = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const rot = readable ? (s.rotation ?? 0) : normDeg(2 * axis - (s.rotation ?? 0));
    const out: Shape = { ...s, x: c.x - s.w / 2, y: c.y - s.h / 2 };
    if (rot) out.rotation = rot;
    else delete out.rotation;
    return out;
  }
  const pts = shapeVertices(s).map((p) => reflectPoint(p, a, b));
  if (s.type === 'line') return lineShape(pts[0], pts[1]);
  return shapeFromVertices({ ...s, rotation: undefined }, pts);
}

/* ───────────── Verbinden ───────────── */

/** Punkte entfernen, die auf einer Geraden liegen (zwei verbundene gerade Linien → eine Linie) */
function simplify(pts: Point[], closed: boolean, tol: number): Point[] {
  let out = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > tol / 10);
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    const n = out.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const a = out[(i - 1 + n) % n];
      const b = out[i];
      const c = out[(i + 1) % n];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const len = dist(a, c);
      // auf der Strecke a–c und (fast) kein Knick
      if (len > EPS && Math.abs(cross) / len < 1e-6 * Math.max(1, len) && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) {
        out = [...out.slice(0, i), ...out.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return out;
}

export interface JoinChain {
  /** Indizes der verbundenen Formen (Eingabe) */
  members: number[];
  shape: Shape;
  closed: boolean;
}

/**
 * Offene Linien, Polylinien und Bögen an gemeinsamen Endpunkten zu einer Polylinie verbinden. Endpunkte im
 * Abstand ≤ tol werden exakt zusammengeführt (Lücke geschlossen). Treffen sich Anfang und Ende, entsteht
 * eine geschlossene Kontur (Fläche). minGap: kleinste verbleibende Lücke zwischen Endpunkten (für Hinweise).
 */
export function joinShapes(shapes: Shape[], tol: number): { chains: JoinChain[]; minGap: number | null } {
  type C = { pts: Point[]; members: number[] };
  const open = shapes.map((s, i) => ({ s, i })).filter(({ s }) => isOpenShape(s) || (s.type === 'freehand' && s.closed === false));
  const pool: C[] = open.map(({ s, i }) => ({ pts: shapeVertices(s), members: [i] }));
  const done: C[] = [];
  while (pool.length) {
    const cur = pool.shift()!;
    for (;;) {
      let best: { k: number; mode: 'ee' | 'es' | 'se' | 'ss'; d: number } | null = null;
      const s0 = cur.pts[0];
      const e0 = cur.pts[cur.pts.length - 1];
      pool.forEach((o, k) => {
        const s1 = o.pts[0];
        const e1 = o.pts[o.pts.length - 1];
        for (const [mode, d] of [
          ['es', dist(e0, s1)],
          ['ee', dist(e0, e1)],
          ['se', dist(s0, e1)],
          ['ss', dist(s0, s1)],
        ] as const)
          if (d <= tol && (!best || d < best.d)) best = { k, mode, d };
      });
      if (!best) break;
      const { k, mode } = best as { k: number; mode: 'ee' | 'es' | 'se' | 'ss' };
      const o = pool.splice(k, 1)[0];
      const op = mode === 'ee' || mode === 'ss' ? [...o.pts].reverse() : o.pts;
      // Endpunkte exakt zusammenführen: der gemeinsame Punkt ist der Endpunkt der bisherigen Kette
      if (mode === 'es' || mode === 'ee') cur.pts = [...cur.pts, ...op.slice(1)];
      else cur.pts = [...op.slice(0, -1), ...cur.pts];
      cur.members.push(...o.members);
    }
    done.push(cur);
  }
  const chains: JoinChain[] = [];
  for (const c of done) {
    const closes = c.pts.length >= 3 && dist(c.pts[0], c.pts[c.pts.length - 1]) <= tol;
    let pts = closes ? c.pts.slice(0, -1) : c.pts;
    pts = simplify(pts, closes, tol);
    // nur, was sich tatsächlich ändert: mehrere Teile verbunden oder eine Linie geschlossen
    if (c.members.length < 2 && !closes) continue;
    const shape = !closes && pts.length === 2 ? lineShape(pts[0], pts[1]) : polygonShape(pts, closes);
    chains.push({ members: c.members, shape, closed: closes });
  }
  // kleinste Lücke zwischen den Enden verschiedener (nicht verbundener) Ketten
  let minGap: number | null = null;
  const ends = done.filter((c) => !(c.pts.length >= 3 && dist(c.pts[0], c.pts[c.pts.length - 1]) <= tol)).map((c) => [c.pts[0], c.pts[c.pts.length - 1]]);
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++)
      for (const p of ends[i]) for (const q of ends[j]) if (minGap === null || dist(p, q) < minGap) minGap = dist(p, q);
  // offene Einzelkette: Abstand Anfang–Ende
  for (const e of ends) if (e[0] !== e[1] && done.length === 1 && (minGap === null || dist(e[0], e[1]) < minGap)) minGap = dist(e[0], e[1]);
  return { chains, minGap };
}

/* ───────────── Versetzen ───────────── */

/** Schnittpunkt der Geraden p1 + t·d1 und p2 + s·d2 (null bei parallel) */
function lineX(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

/** Linienzug um d versetzen (Vorzeichen = Seite der linken Normalen), Ecken auf Gehrung */
export function offsetPath(pts: Point[], d: number, closed: boolean): Point[] {
  const n = pts.length;
  const segs: { p: Point; dir: Point }[] = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = dist(a, b) || EPS;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nrm = { x: -dir.y, y: dir.x };
    segs.push({ p: { x: a.x + nrm.x * d, y: a.y + nrm.y * d }, dir });
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === 0) {
      out.push(segs[0].p);
      continue;
    }
    if (!closed && i === n - 1) {
      const s = segs[m - 1];
      const len = dist(pts[n - 2], pts[n - 1]);
      out.push({ x: s.p.x + s.dir.x * len, y: s.p.y + s.dir.y * len });
      continue;
    }
    const prev = segs[(i - 1 + m) % m];
    const next = segs[i % m];
    const x = lineX(prev.p, prev.dir, next.p, next.dir);
    out.push(x ?? next.p);
  }
  return out;
}

/** Versetzbar: Linien, Polylinien, Bögen, Rechtecke, Dreiecke, Flächen und Kreise */
export const canOffset = (s: Shape) => s.type !== 'freehand' || (s.points?.length ?? 0) >= 2;

/** Abstand eines Punkts zur Kontur der Form (für „durch Punkt“) */
export function distanceToShape(s: Shape, p: Point): number {
  if (s.type === 'ellipse') {
    const c = shapeCenter(s);
    if (Math.abs(s.w - s.h) < 1e-9) return Math.abs(dist(c, p) - s.w / 2);
  }
  const pts = s.type === 'ellipse' ? ellipsePoints(s) : shapeVertices(s);
  return distanceToPolyline(p, pts, !isOpenShape(s));
}

function ellipsePoints(s: Shape, n = 72): Point[] {
  const c = shapeCenter(s);
  const r = ((s.rotation ?? 0) * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = (Math.cos(t) * s.w) / 2;
    const y = (Math.sin(t) * s.h) / 2;
    return { x: c.x + x * Math.cos(r) - y * Math.sin(r), y: c.y + x * Math.sin(r) + y * Math.cos(r) };
  });
}

/**
 * Parallele Kopie im Abstand d auf der Seite des Punkts `side`. Geschlossene Formen: Punkt innen → nach innen,
 * außen → nach außen. Rechteck und Kreis bleiben Rechteck/Kreis. null: nicht möglich (z. B. nach innen zu groß).
 */
export function offsetShape(s: Shape, d: number, side: Point): Shape | null {
  if (!(d > 0)) return null;
  if (s.type === 'rect' || s.type === 'ellipse') {
    const inside = s.type === 'rect' ? pointInPolygon(side, shapeVertices(s)) : pointInPolygon(side, ellipsePoints(s));
    const k = inside ? -1 : 1;
    const w = s.w + 2 * k * d;
    const h = s.h + 2 * k * d;
    if (w <= EPS || h <= EPS) return null;
    const c = shapeCenter(s);
    return { ...s, x: c.x - w / 2, y: c.y - h / 2, w, h };
  }
  const pts = shapeVertices(s);
  if (pts.length < 2) return null;
  const open = isOpenShape(s);
  if (open) {
    // Seite: am nächsten Abschnitt links oder rechts
    let best = { i: 0, dd: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
      const dd = distanceToPolyline(side, [pts[i], pts[i + 1]], false);
      if (dd < best.dd) best = { i, dd };
    }
    const a = pts[best.i];
    const b = pts[best.i + 1];
    const left = (b.x - a.x) * (side.y - a.y) - (b.y - a.y) * (side.x - a.x) > 0;
    // linke Normale (-dy, dx) zeigt im Plan (y nach unten) zur Seite mit positivem Kreuzprodukt
    const out = offsetPath(pts, left ? d : -d, false);
    if (s.type === 'line') return lineShape(out[0], out[1]);
    return shapeFromVertices({ ...s, rotation: undefined }, out);
  }
  const inside = pointInPolygon(side, pts);
  const a = offsetPath(pts, d, true);
  const b = offsetPath(pts, -d, true);
  const areaA = Math.abs(polygonArea(a));
  const areaB = Math.abs(polygonArea(b));
  const orig = Math.abs(polygonArea(pts));
  const out = inside ? (areaA < areaB ? a : b) : areaA > areaB ? a : b;
  const area = Math.abs(polygonArea(out));
  // nach innen zu weit: Kontur klappt um bzw. verschwindet – dann liegt ein neuer Eckpunkt näher als d an der alten Kontur
  if (inside && (area >= orig || area < EPS || out.some((q) => distanceToPolyline(q, pts, true) < d * (1 - 1e-6)))) return null;
  return shapeFromVertices({ ...s, rotation: undefined }, out);
}

/* ───────────── Reihe ───────────── */

export type ArrayParams =
  /** rechteckig: Spalten × Zeilen, Abstand nach rechts (dx) und nach oben (dy) in m */
  | { kind: 'rect'; cols: number; rows: number; dx: number; dy: number }
  /** linear: Anzahl (einschließlich Original), Abstand, Richtung (0° = rechts, gegen den Uhrzeigersinn) */
  | { kind: 'linear'; count: number; dist: number; angle: number }
  /** polar: Anzahl (einschließlich Original), Gesamtwinkel (360 = ganzer Kreis), Objekte mitdrehen */
  | { kind: 'polar'; count: number; total: number; rotate: boolean };

/** Verschiebungen der Kopien (Plan: y nach unten) – ohne das Original */
export function arrayOffsets(p: Exclude<ArrayParams, { kind: 'polar' }>): Point[] {
  const out: Point[] = [];
  if (p.kind === 'rect') {
    for (let r = 0; r < Math.max(1, Math.round(p.rows)); r++)
      for (let c = 0; c < Math.max(1, Math.round(p.cols)); c++) if (r || c) out.push({ x: c * p.dx, y: -r * p.dy });
    return out;
  }
  const a = (p.angle * Math.PI) / 180;
  for (let i = 1; i < Math.max(1, Math.round(p.count)); i++) out.push({ x: round9(i * p.dist * Math.cos(a)), y: round9(-i * p.dist * Math.sin(a)) });
  return out;
}
const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** Winkel der Kopien bei polarer Reihe (gegen den Uhrzeigersinn, ohne das Original) */
export function polarAngles(count: number, total: number): number[] {
  const n = Math.max(1, Math.round(count));
  if (n < 2) return [];
  const full = Math.abs(Math.abs(total) - 360) < 1e-9;
  const step = full ? total / n : total / (n - 1);
  return Array.from({ length: n - 1 }, (_, i) => step * (i + 1));
}

/** Form um den Punkt c drehen (Grad gegen den Uhrzeigersinn); rotateItem = false: nur verschieben (Ausrichtung bleibt) */
export function rotateAround(s: Shape, c: Point, degCcw: number, rotateItem = true): Shape {
  const rot = (p: Point) => {
    const a = (-degCcw * Math.PI) / 180; // Plan: y nach unten → im Uhrzeigersinn gemessen
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const center = shapeCenter(s);
  const nc = rot(center);
  if (!rotateItem || s.type === 'rect' || s.type === 'ellipse') {
    const out: Shape = { ...s, x: s.x + nc.x - center.x, y: s.y + nc.y - center.y };
    if (rotateItem) {
      const r = normDeg((s.rotation ?? 0) - degCcw);
      if (r) out.rotation = r;
      else delete out.rotation;
    }
    return out;
  }
  const pts = shapeVertices(s).map(rot);
  if (s.type === 'line') return lineShape(pts[0], pts[1]);
  return shapeFromVertices({ ...s, rotation: undefined }, pts);
}

/* ───────────── Skalieren ───────────── */

/**
 * Form vom Punkt c aus skalieren: sx/sy (gleich = gleichmäßig). Rechteck/Kreis bleiben Rechteck/Kreis,
 * solange nicht gedreht oder gleichmäßig; gedrehte Rechtecke werden bei ungleichmäßiger Skalierung zur
 * Fläche (Polylinie). null: nicht möglich (gedrehter Kreis ungleichmäßig).
 */
export function scaleAbout(s: Shape, c: Point, sx: number, sy = sx): Shape | null {
  if (!(sx > 0) || !(sy > 0)) return null;
  const uniform = Math.abs(sx - sy) < 1e-12;
  const rotated = !!s.rotation;
  const tp = (p: Point) => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy });
  if (s.type === 'rect' || s.type === 'ellipse') {
    if (uniform || !rotated) {
      const ctr = tp(shapeCenter(s));
      const w = s.w * (uniform ? sx : sx);
      const h = s.h * (uniform ? sx : sy);
      return { ...s, x: ctr.x - w / 2, y: ctr.y - h / 2, w, h };
    }
    if (s.type === 'ellipse') return null;
    return shapeFromVertices({ ...s, type: 'rect', rotation: undefined }, shapeVertices(s).map(tp));
  }
  const pts = shapeVertices(s).map(tp);
  if (s.type === 'line') return lineShape(pts[0], pts[1]);
  return shapeFromVertices({ ...s, rotation: undefined }, pts);
}

/** Winkel der Richtung a→b in Grad, gegen den Uhrzeigersinn (y nach oben), 0…360 */
export function angleCcw(a: Point, b: Point): number {
  const d = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
  return (d + 360) % 360;
}

/* ───────────── Abrunden ───────────── */

type Seg2 = [Point, Point];
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unit = (v: Point) => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : null;
};

/** Schnittpunkt zweier (unendlicher) Geraden; null = parallel */
export function lineLineIntersection([a, b]: Seg2, [c, d]: Seg2): Point | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12 * Math.max(1, Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y))) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** Endpunkt der Linie, der beim Abrunden bleibt: auf der Seite des angetippten Punkts (vom Schnittpunkt aus) */
function keptEnd([a, b]: Seg2, tap: Point, x: Point): Point {
  const dir = unit(sub(b, a)) ?? { x: 1, y: 0 };
  const st = dot(sub(tap, x), dir);
  const sa = dot(sub(a, x), dir);
  const sb = dot(sub(b, x), dir);
  if (Math.sign(sa) === Math.sign(st) && Math.sign(sb) !== Math.sign(st)) return a;
  if (Math.sign(sb) === Math.sign(st) && Math.sign(sa) !== Math.sign(st)) return b;
  return Math.abs(sa) >= Math.abs(sb) ? a : b;
}

export type FilletResult = { a: Seg2; b: Seg2; arc: [Point, Point, Point] | null } | { error: string };

/**
 * Zwei Linien abrunden (wie „Abrunden“ im CAD): beide Linien werden bis zu den Tangentenpunkten gekürzt bzw.
 * verlängert und mit einem Bogen (Radius r) verbunden; r = 0 ergibt eine scharfe Ecke. Die angetippten Punkte
 * bestimmen, welcher Teil jeder Linie bleibt. Ergebnis: neue Linien (bleibender Endpunkt zuerst) und der Bogen
 * (Anfang, Mitte, Ende).
 */
export function filletLines(l1: Seg2, tap1: Point, l2: Seg2, tap2: Point, r: number): FilletResult {
  const x = lineLineIntersection(l1, l2);
  if (!x) return { error: 'Die Linien sind parallel – sie treffen sich nicht.' };
  const k1 = keptEnd(l1, tap1, x);
  const k2 = keptEnd(l2, tap2, x);
  const u1 = unit(sub(k1, x));
  const u2 = unit(sub(k2, x));
  if (!u1 || !u2) return { error: 'Eine Linie endet genau im Schnittpunkt – bitte den anderen Teil antippen.' };
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return { error: 'Die Linien liegen auf einer Geraden.' };
  if (r <= 1e-9)
    return {
      a: [k1, x],
      b: [k2, x],
      arc: null,
    };
  const d = r / Math.tan(theta / 2);
  if (d > Math.hypot(k1.x - x.x, k1.y - x.y) + 1e-9 || d > Math.hypot(k2.x - x.x, k2.y - x.y) + 1e-9) return { error: 'Der Radius ist für diese Linien zu groß.' };
  const t1 = { x: x.x + u1.x * d, y: x.y + u1.y * d };
  const t2 = { x: x.x + u2.x * d, y: x.y + u2.y * d };
  const bis = unit({ x: u1.x + u2.x, y: u1.y + u2.y })!;
  const c = { x: x.x + (bis.x * r) / Math.sin(theta / 2), y: x.y + (bis.y * r) / Math.sin(theta / 2) };
  const m = { x: c.x - bis.x * r, y: c.y - bis.y * r };
  return { a: [k1, t1], b: [k2, t2], arc: [t1, m, t2] };
}

/**
 * Ecke i einer Polylinie bzw. Fläche abrunden: der Eckpunkt wird durch einen fein unterteilten Bogen ersetzt
 * (r = 0: unverändert). Fehler, wenn die Ecke ein offenes Ende ist oder der Radius nicht passt.
 */
export function filletCorner(pts: Point[], closed: boolean, i: number, r: number, segs = 12): Point[] | { error: string } {
  const n = pts.length;
  if (!closed && (i === 0 || i === n - 1)) return { error: 'Ein offenes Ende hat keine Ecke zum Abrunden.' };
  if (r <= 1e-9) return pts;
  const v = pts[i];
  const prev = pts[(i - 1 + n) % n];
  const next = pts[(i + 1) % n];
  const u1 = unit(sub(prev, v));
  const u2 = unit(sub(next, v));
  if (!u1 || !u2) return { error: 'Doppelter Eckpunkt.' };
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return { error: 'Hier ist keine Ecke (gerader Verlauf).' };
  const d = r / Math.tan(theta / 2);
  if (d > Math.hypot(prev.x - v.x, prev.y - v.y) + 1e-9 || d > Math.hypot(next.x - v.x, next.y - v.y) + 1e-9) return { error: 'Der Radius ist für diese Ecke zu groß.' };
  const t1 = { x: v.x + u1.x * d, y: v.y + u1.y * d };
  const t2 = { x: v.x + u2.x * d, y: v.y + u2.y * d };
  const bis = unit({ x: u1.x + u2.x, y: u1.y + u2.y })!;
  const c = { x: v.x + (bis.x * r) / Math.sin(theta / 2), y: v.y + (bis.y * r) / Math.sin(theta / 2) };
  const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
  let sweep = Math.atan2(t2.y - c.y, t2.x - c.x) - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc = Array.from({ length: segs + 1 }, (_, j) => {
    const a = a1 + (sweep * j) / segs;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });
  return [...pts.slice(0, i), ...arc, ...pts.slice(i + 1)];
}

/* ───────────── Abstände ───────────── */

function closestOnSeg(p: Point, [a, b]: Seg2): Point {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return { x: a.x + t * d.x, y: a.y + t * d.y };
}

/** kürzester Abstand zweier Strecken mit den nächstgelegenen Punkten */
export function segSegDistance(s1: Seg2, s2: Seg2): { d: number; p: Point; q: Point } {
  const [a, b] = s1;
  const [c, e] = s2;
  // Schnitt?
  const r = sub(b, a);
  const s = sub(e, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) > 1e-15) {
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const x = { x: a.x + t * r.x, y: a.y + t * r.y };
      return { d: 0, p: x, q: x };
    }
  }
  const cands = [
    { p: a, q: closestOnSeg(a, s2) },
    { p: b, q: closestOnSeg(b, s2) },
    { p: closestOnSeg(c, s1), q: c },
    { p: closestOnSeg(e, s1), q: e },
  ];
  let best = { d: Infinity, p: a, q: c };
  for (const k of cands) {
    const d = Math.hypot(k.p.x - k.q.x, k.p.y - k.q.y);
    if (d < best.d) best = { d, ...k };
  }
  return best;
}

/** kleinster Winkel (0…90°) zwischen zwei Strecken */
export function angleBetween(s1: Seg2, s2: Seg2): number {
  const u = unit(sub(s1[1], s1[0]));
  const v = unit(sub(s2[1], s2[0]));
  if (!u || !v) return 0;
  const a = (Math.acos(Math.min(1, Math.abs(dot(u, v)))) * 180) / Math.PI;
  return a;
}

/** Abstand eines Punkts zur unendlichen Geraden durch die Strecke, mit Lotfußpunkt */
export function pointLineDistance(p: Point, [a, b]: Seg2): { d: number; foot: Point } {
  const dir = unit(sub(b, a));
  if (!dir) return { d: Math.hypot(p.x - a.x, p.y - a.y), foot: a };
  const t = dot(sub(p, a), dir);
  const foot = { x: a.x + dir.x * t, y: a.y + dir.y * t };
  return { d: Math.hypot(p.x - foot.x, p.y - foot.y), foot };
}
