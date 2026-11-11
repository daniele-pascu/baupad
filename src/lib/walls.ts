import { offsetPath } from './cad-ops';
import { type Point } from './geometry';

/**
 * Wände: Achse (Linie bzw. Polylinie) mit Stärke und optionaler Höhe. Gezeichnet wird die Wand als
 * Umriss beider Seiten (Ecken auf Gehrung); Türen und Fenster, die auf der Achse sitzen, schneiden die
 * Öffnung aus (Laibungen werden gezeichnet). Länge und Fläche (Länge × Höhe) aus der Achse.
 */

export interface WallOpening {
  /** Mitte des Bauteils (gleiche Einheit wie die Achse) */
  c: Point;
  /** Breite der Öffnung */
  w: number;
  /** Richtung des Bauteils in Grad */
  angle: number;
}

export interface WallGeometry {
  /** Flächenstücke (je ein Viereck zwischen Öffnungen) */
  quads: Point[][];
  /** Umrisslinien (Seiten, Enden, Laibungen) */
  lines: [Point, Point][];
  /** Anzahl der ausgesparten Öffnungen */
  gaps: number;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function wallGeometry(axis: Point[], closed: boolean, t: number, openings: WallOpening[] = []): WallGeometry {
  const quads: Point[][] = [];
  const lines: [Point, Point][] = [];
  let gapCount = 0;
  if (axis.length < 2 || !(t > 0)) return { quads, lines, gaps: 0 };
  const L = offsetPath(axis, t / 2, closed);
  const R = offsetPath(axis, -t / 2, closed);
  const n = axis.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = axis[i];
    const b = axis[(i + 1) % n];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    const segAngle = (Math.atan2(uy, ux) * 180) / Math.PI;
    // Öffnungen auf diesem Abschnitt: Mitte nah an der Achse, Bauteil parallel
    const gaps: [number, number][] = [];
    for (const o of openings) {
      const s = (o.c.x - a.x) * ux + (o.c.y - a.y) * uy;
      const off = Math.abs((o.c.x - a.x) * nx + (o.c.y - a.y) * ny);
      const par = Math.abs(Math.sin(((o.angle - segAngle) * Math.PI) / 180)) < 0.08;
      if (par && off <= t / 2 + 1e-6 + t * 0.05 && s > 0 && s < len) gaps.push([Math.max(0, s - o.w / 2), Math.min(len, s + o.w / 2)]);
    }
    gaps.sort((p, q) => p[0] - q[0]);
    gapCount += gaps.length;
    // Abschnitt in Stücke ohne Öffnung teilen
    const pieces: [number, number][] = [];
    let cur = 0;
    for (const [g0, g1] of gaps) {
      if (g0 > cur + 1e-9) pieces.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (cur < len - 1e-9) pieces.push([cur, len]);
    const left = (s: number) => (s <= 1e-9 ? L[i] : s >= len - 1e-9 ? L[(i + 1) % n] : { x: a.x + ux * s + (nx * t) / 2, y: a.y + uy * s + (ny * t) / 2 });
    const right = (s: number) => (s <= 1e-9 ? R[i] : s >= len - 1e-9 ? R[(i + 1) % n] : { x: a.x + ux * s - (nx * t) / 2, y: a.y + uy * s - (ny * t) / 2 });
    for (const [s0, s1] of pieces) {
      quads.push([left(s0), left(s1), right(s1), right(s0)]);
      lines.push([left(s0), left(s1)], [right(s0), right(s1)]);
      // Laibung an einer Öffnung
      if (s0 > 1e-9) lines.push([left(s0), right(s0)]);
      if (s1 < len - 1e-9) lines.push([left(s1), right(s1)]);
    }
  }
  if (!closed) lines.push([L[0], R[0]], [L[n - 1], R[n - 1]]);
  return { quads, lines, gaps: gapCount };
}

/** Länge der Achse */
export function axisLength(axis: Point[], closed: boolean): number {
  let l = 0;
  for (let i = 1; i < axis.length; i++) l += dist(axis[i - 1], axis[i]);
  if (closed && axis.length > 2) l += dist(axis[axis.length - 1], axis[0]);
  return l;
}

import { fromShapeLocal, shapeCenter } from './geometry';
import { symbolDef } from './symbols';
import type { DrawElement } from './types';

/**
 * Öffnungen aus Türen und Fenstern (Seitenkoordinaten: Form × k). Bezugspunkt: Fenster = Mitte,
 * Tür = Mitte der Öffnungslinie (sie liegt auf der Wandachse).
 */
export function wallOpenings(elements: Pick<DrawElement, 'type' | 'shape' | 'symbol'>[], k = 1): WallOpening[] {
  const out: WallOpening[] = [];
  for (const e of elements) {
    if (e.type !== 'symbol' || !e.symbol) continue;
    const g = symbolDef(e.symbol.id)?.group;
    if (g !== 'door' && g !== 'window') continue;
    const s = e.shape;
    const ref = g === 'door' ? fromShapeLocal(s, { x: s.x + s.w / 2, y: s.y + (e.symbol.flipY ? 0 : s.h) }) : shapeCenter(s);
    out.push({ c: { x: ref.x * k, y: ref.y * k }, w: s.w * k, angle: s.rotation ?? 0 });
  }
  return out;
}
