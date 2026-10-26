import type { Rect } from './types';

/**
 * Grundlegende Erkennung von Planbereichen auf einer Seite.
 *
 * Vorgehen:
 * 1. Seite als Graustufenbild auswerten, „Tinte“ = dunkle Pixel.
 * 2. Lange gerade Linien (Blattrahmen, Planrahmen) entfernen, da sie benachbarte
 *    Planfelder sonst verbinden.
 * 3. Rekursiver XY-Schnitt: Die Seite wird entlang breiter leerer Streifen geteilt.
 * 4. Nur ausreichend große Bereiche werden vorgeschlagen.
 *
 * Das Ergebnis ist ausdrücklich nur ein Vorschlag, den der Benutzer prüft und korrigiert.
 */

export interface DetectOptions {
  /** Helligkeitsschwelle für „Tinte“ (0–255) */
  threshold?: number;
  /** Mindestanteil an der Seitenfläche, damit ein Bereich vorgeschlagen wird */
  minAreaRatio?: number;
}

export function detectLayoutRegions(
  image: ImageData,
  pageWidth: number,
  pageHeight: number,
  opts: DetectOptions = {},
): Rect[] {
  const { width: W, height: H, data } = image;
  const threshold = opts.threshold ?? 200;
  const minAreaRatio = opts.minAreaRatio ?? 0.04;

  const ink = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const a = data[p + 3];
    const lum = a < 128 ? 255 : 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    ink[i] = lum < threshold ? 1 : 0;
  }

  removeLongLines(ink, W, H);

  const minGapX = Math.max(3, Math.round(W * 0.012));
  const minGapY = Math.max(3, Math.round(H * 0.012));
  const blocks: Rect[] = [];
  xyCut(ink, W, H, { x: 0, y: 0, w: W, h: H }, 0, minGapX, minGapY, blocks);

  const sx = pageWidth / W;
  const sy = pageHeight / H;
  const minArea = minAreaRatio * W * H;
  const margin = Math.round(Math.min(W, H) * 0.006);
  const result = blocks
    .filter((b) => b.w * b.h >= minArea && b.w > W * 0.08 && b.h > H * 0.08)
    .map((b) => {
      const x = Math.max(0, b.x - margin);
      const y = Math.max(0, b.y - margin);
      const x2 = Math.min(W, b.x + b.w + margin);
      const y2 = Math.min(H, b.y + b.h + margin);
      return { x: x * sx, y: y * sy, w: (x2 - x) * sx, h: (y2 - y) * sy };
    })
    .sort((a, b) => (Math.abs(a.y - b.y) > pageHeight * 0.05 ? a.y - b.y : a.x - b.x));

  // Ein einziger Bereich, der fast die ganze Seite abdeckt, ist kein brauchbarer Vorschlag.
  if (result.length === 1 && result[0].w * result[0].h > 0.8 * pageWidth * pageHeight) return [];
  return result.slice(0, 12);
}

/** Entfernt waagerechte und senkrechte Linien, die länger als ~30 % der Seitenmaße sind. */
function removeLongLines(ink: Uint8Array, W: number, H: number) {
  const minH = Math.round(W * 0.3);
  const minV = Math.round(H * 0.3);
  const hRuns: [number, number, number][] = []; // y, x0, x1
  const vRuns: [number, number, number][] = []; // x, y0, y1
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && ink[y * W + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minH) hRuns.push([y, start, x]);
        start = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && ink[y * W + x] === 1;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minV) vRuns.push([x, start, y]);
        start = -1;
      }
    }
  }
  for (const [y, x0, x1] of hRuns) ink.fill(0, y * W + x0, y * W + x1);
  for (const [x, y0, y1] of vRuns) for (let y = y0; y < y1; y++) ink[y * W + x] = 0;
}

function xyCut(
  ink: Uint8Array,
  W: number,
  H: number,
  r: Rect,
  depth: number,
  minGapX: number,
  minGapY: number,
  out: Rect[],
) {
  const tight = tighten(ink, W, r);
  if (!tight) return;
  if (depth > 6) {
    out.push(tight);
    return;
  }
  const rows = profile(ink, W, tight, 'y');
  const cols = profile(ink, W, tight, 'x');
  // Kleine Störungen (Text-Reste, Punkte) ignorieren
  const rowNoise = Math.max(1, Math.round(tight.w * 0.002));
  const colNoise = Math.max(1, Math.round(tight.h * 0.002));
  const rowSegs = segments(rows, rowNoise, minGapY);
  const colSegs = segments(cols, colNoise, minGapX);

  // In der Richtung mit dem breitesten Leerstreifen zuerst schneiden
  const gapOf = (segs: [number, number][]) =>
    segs.length < 2 ? 0 : Math.max(...segs.slice(1).map((s, i) => s[0] - segs[i][1]));
  const gy = gapOf(rowSegs);
  const gx = gapOf(colSegs);
  if (gy === 0 && gx === 0) {
    out.push(tight);
    return;
  }
  if (gy >= gx) {
    for (const [a, b] of rowSegs)
      xyCut(ink, W, H, { x: tight.x, y: tight.y + a, w: tight.w, h: b - a }, depth + 1, minGapX, minGapY, out);
  } else {
    for (const [a, b] of colSegs)
      xyCut(ink, W, H, { x: tight.x + a, y: tight.y, w: b - a, h: tight.h }, depth + 1, minGapX, minGapY, out);
  }
}

function profile(ink: Uint8Array, W: number, r: Rect, axis: 'x' | 'y'): Uint32Array {
  const out = new Uint32Array(axis === 'y' ? r.h : r.w);
  for (let y = 0; y < r.h; y++) {
    const row = (r.y + y) * W + r.x;
    for (let x = 0; x < r.w; x++) {
      if (ink[row + x]) {
        if (axis === 'y') out[y]++;
        else out[x]++;
      }
    }
  }
  return out;
}

/** Zusammenhängende belegte Abschnitte, getrennt durch Lücken ≥ minGap. */
function segments(p: Uint32Array, noise: number, minGap: number): [number, number][] {
  const segs: [number, number][] = [];
  let start = -1;
  let lastInk = -1;
  for (let i = 0; i < p.length; i++) {
    if (p[i] > noise) {
      if (start < 0) start = i;
      else if (i - lastInk - 1 >= minGap) {
        segs.push([start, lastInk + 1]);
        start = i;
      }
      lastInk = i;
    }
  }
  if (start >= 0) segs.push([start, lastInk + 1]);
  return segs;
}

function tighten(ink: Uint8Array, W: number, r: Rect): Rect | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -1;
  let y2 = -1;
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * W;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (ink[row + x]) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/**
 * Weiße Ränder erkennen: Rahmen um den gesamten Inhalt der Seite (mit kleinem Abstand).
 * Einzelne Staubpunkte von Scans zählen nicht. `null`, wenn kein nennenswerter Rand da ist
 * (Inhalt füllt die Seite fast ganz) oder die Seite leer ist. Nur ein Vorschlag.
 */
export function contentBounds(image: ImageData, pageWidth: number, pageHeight: number, opts: { threshold?: number } = {}): Rect | null {
  const { width: W, height: H, data } = image;
  const threshold = opts.threshold ?? 215;
  const rows = new Uint32Array(H);
  const cols = new Uint32Array(W);
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p += 4) {
      const lum = data[p + 3] < 128 ? 255 : 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      if (lum < threshold) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const minRow = Math.max(2, Math.round(W * 0.002));
  const minCol = Math.max(2, Math.round(H * 0.002));
  const first = (a: Uint32Array, min: number) => a.findIndex((n) => n >= min);
  const last = (a: Uint32Array, min: number) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= min) return i;
    return -1;
  };
  const y0 = first(rows, minRow);
  const x0 = first(cols, minCol);
  if (y0 < 0 || x0 < 0) return null;
  const y1 = last(rows, minRow) + 1;
  const x1 = last(cols, minCol) + 1;
  const pad = Math.round(Math.min(W, H) * 0.01);
  const bx = Math.max(0, x0 - pad);
  const by = Math.max(0, y0 - pad);
  const bw = Math.min(W, x1 + pad) - bx;
  const bh = Math.min(H, y1 + pad) - by;
  if (bw * bh >= 0.94 * W * H || bw < W * 0.05 || bh < H * 0.05) return null;
  const sx = pageWidth / W;
  const sy = pageHeight / H;
  return { x: bx * sx, y: by * sy, w: bw * sx, h: bh * sy };
}
