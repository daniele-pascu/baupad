import type { Point } from './geometry';
import type { Rect } from './types';

/**
 * Punktfang auf den Linien des PDF-Plans (nur Vektor-PDFs): Strecken aus den Pfaden der Seite
 * in Plankoordinaten, in einem Raster abgelegt, damit die Suche beim Bewegen schnell bleibt.
 * Fotos und Scans haben keine Linien – dort gibt es diesen Fang nicht.
 */

/** Strecke eines PDF-Pfads. `ends`: Bit 1 = a ist Eckpunkt, Bit 2 = b ist Eckpunkt (bei Kurven nur die Enden) */
export interface PlanSeg {
  a: Point;
  b: Point;
  ends: number;
  /** gerade Strecke (Mittelpunkt sinnvoll); false = Teilstück einer Kurve */
  straight: boolean;
  /** Pfad und Lage im Pfad (benachbarte Strecken treffen sich in einer Ecke, kein Schnittpunkt) */
  path: number;
  index: number;
}

type M = [number, number, number, number, number, number];
const apply = (m: M, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
/** A∘B: erst B, dann A */
export const mul = (A: M, B: M): M => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];

/** Höchstzahl an Strecken (sehr dichte Pläne: Speicher und Tempo auf Tablets) */
export const MAX_SEGS = 200_000;

/** pdf.js-Zeichenbefehle (DrawOPS) eines Pfads → Strecken in Plankoordinaten */
export function pathSegments(data: ArrayLike<number>, m: M, pathId: number, out: PlanSeg[], region: Rect | null): void {
  let cur: Point | null = null;
  let start: Point | null = null;
  let index = 0;
  const inside = (p: Point, q: Point) =>
    !region || !(Math.max(p.x, q.x) < region.x || Math.min(p.x, q.x) > region.x + region.w || Math.max(p.y, q.y) < region.y || Math.min(p.y, q.y) > region.y + region.h);
  const push = (a: Point, b: Point, ends: number, straight: boolean) => {
    if (out.length >= MAX_SEGS || (a.x === b.x && a.y === b.y) || !inside(a, b)) return;
    out.push({ a, b, ends, straight, path: pathId, index: index++ });
  };
  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case 0: // moveTo
        cur = start = apply(m, data[i++], data[i++]);
        index += 2; // neuer Teilpfad: nicht benachbart
        break;
      case 1: {
        // lineTo
        const p = apply(m, data[i++], data[i++]);
        if (cur) push(cur, p, 3, true);
        cur = p;
        break;
      }
      case 2: {
        // curveTo: in 8 Teilstücke zerlegt, nur Anfang und Ende sind Eckpunkte
        const c1 = [data[i++], data[i++]];
        const c2 = [data[i++], data[i++]];
        const e = [data[i++], data[i++]];
        if (cur) {
          const s: Point = cur;
          const q = (t: number) => {
            const u = 1 - t;
            // Bézier in Plankoordinaten (Kontrollpunkte vorher transformiert)
            const P1 = apply(m, c1[0], c1[1]);
            const P2 = apply(m, c2[0], c2[1]);
            const P3 = apply(m, e[0], e[1]);
            return {
              x: u * u * u * s.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
              y: u * u * u * s.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
            };
          };
          let prev: Point = s;
          for (let k = 1; k <= 8; k++) {
            const p = k === 8 ? apply(m, e[0], e[1]) : q(k / 8);
            push(prev, p, (k === 1 ? 1 : 0) | (k === 8 ? 2 : 0), false);
            prev = p;
          }
          cur = prev;
        } else cur = apply(m, e[0], e[1]);
        break;
      }
      case 3: {
        // quadraticCurveTo: als gerade Verbindung der Enden (selten in Plänen)
        i += 2;
        const p = apply(m, data[i++], data[i++]);
        if (cur) push(cur, p, 3, false);
        cur = p;
        break;
      }
      case 4: // closePath
        if (cur && start) push(cur, start, 3, true);
        cur = start;
        break;
      default:
        return; // unbekannt: Pfad abbrechen
    }
  }
}

/** Rasterindex für die Suche nach Strecken in der Nähe eines Punkts */
export class SegIndex {
  private cells = new Map<number, number[]>();
  constructor(
    readonly segs: PlanSeg[],
    private size = 24,
  ) {
    segs.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / size);
      const x1 = Math.floor(Math.max(s.a.x, s.b.x) / size);
      const y0 = Math.floor(Math.min(s.a.y, s.b.y) / size);
      const y1 = Math.floor(Math.max(s.a.y, s.b.y) / size);
      // sehr lange Linien (Blattrahmen) belegen viele Zellen – begrenzt durch die Seitengröße
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = x * 100_003 + y;
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }

  /** Strecken im Umkreis `tol`, die nächsten zuerst, höchstens `max` */
  near(p: Point, tol: number, max = 60): PlanSeg[] {
    const s = this.size;
    const seen = new Set<number>();
    const found: { seg: PlanSeg; d: number }[] = [];
    for (let x = Math.floor((p.x - tol) / s); x <= Math.floor((p.x + tol) / s); x++)
      for (let y = Math.floor((p.y - tol) / s); y <= Math.floor((p.y + tol) / s); y++)
        for (const i of this.cells.get(x * 100_003 + y) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const seg = this.segs[i];
          const d = distToSeg(p, seg.a, seg.b);
          if (d <= tol) found.push({ seg, d });
        }
    return found
      .sort((a, b) => a.d - b.d)
      .slice(0, max)
      .map((f) => f.seg);
  }
}

export function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
