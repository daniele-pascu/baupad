import { isOpenShape, pointInPolygon, shapeVertices, type Point } from './geometry';
import { edgesOf } from './snap';
import type { DrawElement } from './types';
import { wallGeometry } from './walls';

/**
 * Geschlossene Bereiche (Räume) einer Zeichnung erkennen – auch wenn sie aus einzelnen Wänden, Linien und Formen
 * zusammengesetzt sind: alle Kanten werden an ihren Schnitt- und Berührpunkten geteilt (ebener Graph) und vom
 * angetippten Punkt aus wird die kleinste umschließende Masche verfolgt. Türen und Fenster schließen eine Wand
 * (die Wand wird ohne Öffnungen genommen), damit ein Raum mit Tür trotzdem geschlossen ist.
 *
 * Alle Werte in Metern (Zeichnungskoordinaten, y nach unten).
 */

type Seg = [Point, Point];

/** Kanten aller Zeichnungsobjekte, die Räume begrenzen (ohne Text, Maße und Bauteil-Symbole) */
export function boundarySegments(elements: Pick<DrawElement, 'type' | 'shape' | 'wall'>[]): Seg[] {
  const out: Seg[] = [];
  for (const e of elements) {
    if (e.type === 'text' || e.type === 'dimension' || e.type === 'symbol') continue;
    if (e.type === 'wall') {
      const axis = shapeVertices(e.shape);
      if (axis.length < 2) continue;
      const quads = wallGeometry(axis, !isOpenShape(e.shape), e.wall?.thickness ?? 0.25).quads;
      for (const q of quads) for (let i = 0; i < q.length; i++) out.push([q[i], q[(i + 1) % q.length]]);
      continue;
    }
    out.push(...(edgesOf(e.shape) as Seg[]));
  }
  return out.filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-6);
}

const KEY = 1e5; // 0,01 mm
const keyOf = (p: Point) => `${Math.round(p.x * KEY)},${Math.round(p.y * KEY)}`;

/** Kleinste geschlossene Masche um den Punkt p (Umriss in Zeichnungskoordinaten) oder null */
export function regionAt(p: Point, segs: Seg[]): { outline: Point[]; area: number } | null {
  if (!segs.length) return null;
  // in y-oben rechnen (mathematischer Drehsinn), am Ende zurück
  const S = segs.map(([a, b]) => [{ x: a.x, y: -a.y }, { x: b.x, y: -b.y }] as Seg);
  const P = { x: p.x, y: -p.y };
  const box = S.map(([a, b]) => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]);
  const cuts: number[][] = S.map(() => [0, 1]);
  const eps = 1e-9;
  for (let i = 0; i < S.length; i++) {
    const [p0, p1] = S[i];
    const rx = p1.x - p0.x;
    const ry = p1.y - p0.y;
    const rr = rx * rx + ry * ry;
    for (let j = i + 1; j < S.length; j++) {
      const bi = box[i];
      const bj = box[j];
      if (bi[0] > bj[2] + 1e-6 || bj[0] > bi[2] + 1e-6 || bi[1] > bj[3] + 1e-6 || bj[1] > bi[3] + 1e-6) continue;
      const [q0, q1] = S[j];
      const sx = q1.x - q0.x;
      const sy = q1.y - q0.y;
      const ss = sx * sx + sy * sy;
      const d = rx * sy - ry * sx;
      const qpx = q0.x - p0.x;
      const qpy = q0.y - p0.y;
      if (Math.abs(d) > 1e-12 * Math.sqrt(rr * ss)) {
        const t = (qpx * sy - qpy * sx) / d;
        const u = (qpx * ry - qpy * rx) / d;
        const tolT = 1e-7 / Math.sqrt(rr);
        const tolU = 1e-7 / Math.sqrt(ss);
        if (t >= -tolT && t <= 1 + tolT && u >= -tolU && u <= 1 + tolU) {
          cuts[i].push(Math.min(1, Math.max(0, t)));
          cuts[j].push(Math.min(1, Math.max(0, u)));
        }
      } else if (Math.abs(qpx * ry - qpy * rx) / Math.sqrt(rr) < 1e-7) {
        // gleiche Gerade: Endpunkte der einen auf der anderen teilen
        const tq0 = (qpx * rx + qpy * ry) / rr;
        const tq1 = ((q1.x - p0.x) * rx + (q1.y - p0.y) * ry) / rr;
        for (const t of [tq0, tq1]) if (t > eps && t < 1 - eps) cuts[i].push(t);
        const up0 = ((p0.x - q0.x) * sx + (p0.y - q0.y) * sy) / ss;
        const up1 = ((p1.x - q0.x) * sx + (p1.y - q0.y) * sy) / ss;
        for (const u of [up0, up1]) if (u > eps && u < 1 - eps) cuts[j].push(u);
      }
    }
  }
  // Knoten und Kanten
  const pts = new Map<string, Point>();
  const adj = new Map<string, Set<string>>();
  const node = (q: Point) => {
    const k = keyOf(q);
    if (!pts.has(k)) {
      pts.set(k, { x: Math.round(q.x * KEY) / KEY, y: Math.round(q.y * KEY) / KEY });
      adj.set(k, new Set());
    }
    return k;
  };
  S.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    let prev = node(a);
    for (const t of ts.slice(1)) {
      const k = node({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (k !== prev) {
        adj.get(prev)!.add(k);
        adj.get(k)!.add(prev);
      }
      prev = k;
    }
  });
  const angle = (from: string, to: string) => {
    const a = pts.get(from)!;
    const b = pts.get(to)!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // Strahl nach rechts: getroffene Kanten nach Abstand
  const hits: { x: number; u: string; v: string }[] = [];
  const seen = new Set<string>();
  for (const [u, ns] of adj) {
    for (const v of ns) {
      const id = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const a = pts.get(u)!;
      const b = pts.get(v)!;
      if (a.y === b.y || (a.y > P.y) === (b.y > P.y)) continue;
      const x = a.x + ((P.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x <= P.x) continue;
      // nach oben gerichtet → P liegt links der Kante
      hits.push(a.y < b.y ? { x, u, v } : { x, u: v, v: u });
    }
  }
  hits.sort((m, n) => m.x - n.x);
  for (const h of hits.slice(0, 24)) {
    const loop = trace(h.u, h.v, adj, angle);
    if (!loop) continue;
    const poly = clean(loop.map((k) => pts.get(k)!));
    if (poly.length < 3) continue;
    const signed = signedArea(poly);
    if (signed <= 1e-9 || !pointInPolygon(P, poly)) continue;
    return { outline: poly.map((q) => ({ x: q.x, y: -q.y })), area: Math.round(signed * 1e6) / 1e6 };
  }
  return null;
}

/** Masche links der Halbkante u→v verfolgen: an jedem Knoten die erste Kante im Uhrzeigersinn ab der Rückrichtung */
function trace(u0: string, v0: string, adj: Map<string, Set<string>>, angle: (a: string, b: string) => number): string[] | null {
  const loop: string[] = [];
  let u = u0;
  let v = v0;
  for (let n = 0; n < 20000; n++) {
    loop.push(u);
    const back = angle(v, u);
    let best: string | null = null;
    let bestTurn = Infinity;
    for (const w of adj.get(v)!) {
      if (w === u && adj.get(v)!.size > 1) continue;
      // Drehung im Uhrzeigersinn von der Rückrichtung bis zur Kante (0 … 2π)
      let turn = back - angle(v, w);
      while (turn <= 1e-12) turn += Math.PI * 2;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = w;
      }
    }
    if (!best) return null;
    u = v;
    v = best;
    if (u === u0 && v === v0) return loop;
  }
  return null;
}

/** Stichkanten (hin und zurück) und doppelte Punkte entfernen */
function clean(poly: Point[]): Point[] {
  const out = [...poly];
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const same = (m: Point, n: Point) => Math.abs(m.x - n.x) < 1e-9 && Math.abs(m.y - n.y) < 1e-9;
      if (same(a, b)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
      if (same(a, c)) {
        // Stich a → b → a: b und das zweite a weg
        const j = (i + 1) % out.length;
        for (const k of [i, j].sort((x, y) => y - x)) out.splice(k, 1);
        changed = true;
        break;
      }
      // Punkt auf gerader Strecke weglassen
      const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cr) < 1e-12 && dot > 0) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function signedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Fläche (m²) des Raums, in dem der Punkt liegt, oder null */
export const roomAreaAt = (p: Point, elements: Pick<DrawElement, 'type' | 'shape' | 'wall'>[]) => regionAt(p, boundarySegments(elements));

/**
 * Raumstempel mit aktueller Fläche: jeder Stempel misst den Raum, in dem seine Mitte liegt (Wände/Linien geändert →
 * Fläche passt sich an). Liegt er in keinem geschlossenen Raum, bleibt die zuletzt ermittelte Fläche stehen.
 */
export function withRoomAreas<T extends Pick<DrawElement, 'type' | 'shape' | 'wall' | 'room' | 'text' | 'font'>>(elements: T[], width?: (e: T, h: number) => number): T[] {
  if (!elements.some((e) => e.room)) return elements;
  const segs = boundarySegments(elements);
  return elements.map((e) => {
    if (!e.room) return e;
    const s = e.shape;
    const r = regionAt({ x: s.x + s.w / 2, y: s.y + s.h / 2 }, segs);
    if (!r) return e;
    const area = Math.round(r.area * 1e4) / 1e4;
    if (e.room.area !== null && Math.abs(e.room.area - area) < 5e-5) return e;
    const next = { ...e, room: { ...e.room, area } };
    if (!width) return next;
    // Breite an die neue Flächenzeile anpassen, Mitte bleibt
    const w = width(next, s.h);
    return { ...next, shape: { ...s, x: s.x + (s.w - w) / 2, w } };
  });
}
