import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getBlob } from './db';
import type { PlanRotation, Rect } from './types';

/*
 * PDF-Darstellung mit pdf.js. Es wird der „legacy“-Build verwendet, damit auch ältere
 * iPads/iPhones unterstützt werden. Worker, Schriften, CMaps und WASM-Decoder werden mit
 * der App ausgeliefert und stehen damit offline zur Verfügung.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = `${location.origin}/pdfjs/`;

export function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js übernimmt den Puffer in den Worker – daher eine Kopie übergeben.
  return pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/',
    enableXfa: false,
  }).promise;
}

export function closePdf(doc: PDFDocumentProxy): Promise<void> {
  return doc.loadingTask.destroy();
}

// Zwischenspeicher für geöffnete Dokumente (begrenzt, um Speicher auf iPhone/iPad zu schonen)
const docCache = new Map<string, Promise<PDFDocumentProxy>>();
const MAX_DOCS = 2;

export function getPdfDocument(fileId: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(fileId);
  if (p) {
    docCache.delete(fileId);
    docCache.set(fileId, p);
    return p;
  }
  p = (async () => {
    const data = await getBlob(fileId);
    if (!data) throw new Error('Originaldatei nicht gefunden.');
    return openPdf(data);
  })();
  p.catch(() => docCache.delete(fileId));
  docCache.set(fileId, p);
  while (docCache.size > MAX_DOCS) {
    const [oldest, old] = docCache.entries().next().value!;
    docCache.delete(oldest);
    old.then((d) => closePdf(d)).catch(() => {});
  }
  return p;
}

/**
 * Drehung eines Plans (im Uhrzeigersinn) zusätzlich zur Seitendrehung der Datei. Alle
 * Plankoordinaten (Messungen, Ausschnitt, Kalibrierung) beziehen sich auf die gedrehte Seite.
 */
const turn = (page: PDFPageProxy, rot: PlanRotation = 0) => (((page.rotate + rot) % 360) + 360) % 360;

/** pdf.js-Ansicht einer Seite inkl. Plandrehung */
export function pageViewport(page: PDFPageProxy, rot: PlanRotation = 0, scale = 1, offsetX = 0, offsetY = 0) {
  return page.getViewport({ scale, rotation: turn(page, rot), offsetX, offsetY });
}

/** Größe der Seite in Seitenkoordinaten (PDF-Punkte, Seiten- und Plandrehung berücksichtigt). */
export function pageSize(page: PDFPageProxy, rot: PlanRotation = 0): { width: number; height: number } {
  const vp = pageViewport(page, rot);
  return { width: vp.width, height: vp.height };
}

/** Größe nach Drehung (Breite/Höhe vertauscht bei 90°/270°) */
export function rotatedSize(width: number, height: number, rot: PlanRotation = 0): { width: number; height: number } {
  return rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
}

/** Größte sichere Canvas-Fläche (iOS Safari begrenzt auf ca. 16,7 Mio. Pixel). */
export const MAX_CANVAS_PIXELS = 16_000_000;
export const MAX_CANVAS_SIDE = 8192;

export function clampRenderScale(w: number, h: number, scale: number): number {
  let s = scale;
  if (w * s > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / w;
  if (h * s > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / h;
  if (w * h * s * s > MAX_CANVAS_PIXELS) s = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  return s;
}

export interface RenderJob {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Rendert den Ausschnitt `region` (Seitenkoordinaten) einer PDF-Seite mit `scale`
 * Pixeln pro Seiteneinheit in das Canvas.
 */
export function renderPdfRegion(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  region: Rect,
  scale: number,
  rot: PlanRotation = 0,
): RenderJob {
  const width = Math.max(1, Math.round(region.w * scale));
  const height = Math.max(1, Math.round(region.h * scale));
  canvas.width = width;
  canvas.height = height;
  const viewport = pageViewport(page, rot, scale, -region.x * scale, -region.y * scale);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const task = page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' });
  return {
    promise: task.promise.catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'RenderingCancelledException') return;
      throw e;
    }),
    cancel: () => task.cancel(),
  };
}

/** Rendert eine Seite (bzw. einen Ausschnitt) mit einer maximalen Kantenlänge in Pixeln. */
export async function renderPdfToCanvas(
  page: PDFPageProxy,
  maxSide: number,
  region?: Rect | null,
  rot: PlanRotation = 0,
): Promise<HTMLCanvasElement> {
  const size = pageSize(page, rot);
  const r = region ?? { x: 0, y: 0, w: size.width, h: size.height };
  const scale = clampRenderScale(r.w, r.h, maxSide / Math.max(r.w, r.h));
  const canvas = document.createElement('canvas');
  await renderPdfRegion(page, canvas, r, scale, rot).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden.'))), type, quality),
  );
}

// ---------------------------------------------------------------------------
// Bilder

/** Lädt ein Bild mit korrekt angewendeter EXIF-Ausrichtung. */
export async function loadImageBitmap(data: ArrayBuffer, mimeType: string): Promise<ImageBitmap> {
  const blob = new Blob([data], { type: mimeType });
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback für Browser ohne createImageBitmap-Optionen
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const bitmapCache = new Map<string, Promise<ImageBitmap>>();

export function getImageBitmap(fileId: string, mimeType: string): Promise<ImageBitmap> {
  let p = bitmapCache.get(fileId);
  if (p) return p;
  p = (async () => {
    const data = await getBlob(fileId);
    if (!data) throw new Error('Originaldatei nicht gefunden.');
    return loadImageBitmap(data, mimeType);
  })();
  p.catch(() => bitmapCache.delete(fileId));
  bitmapCache.set(fileId, p);
  while (bitmapCache.size > 2) {
    const [oldest, old] = bitmapCache.entries().next().value!;
    bitmapCache.delete(oldest);
    old.then((b) => b.close()).catch(() => {});
  }
  return p;
}

/**
 * Zeichnet den Ausschnitt `r` (Koordinaten des gedrehten Bildes) auf die Fläche w × h Pixel
 * oben links im Canvas.
 */
export function drawImageRegion(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, r: Rect, w: number, h: number, rot: PlanRotation = 0): void {
  if (!rot) {
    ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, w, h);
    return;
  }
  // Bildpunkt (x, y) → gedrehter Punkt (X, Y) → Pixel ((X − r.x)·sx, (Y − r.y)·sy)
  const W = bitmap.width;
  const H = bitmap.height;
  const sx = w / r.w;
  const sy = h / r.h;
  ctx.save();
  if (rot === 90) ctx.setTransform(0, sy, -sx, 0, (H - r.x) * sx, -r.y * sy); // X = H − y, Y = x
  else if (rot === 180) ctx.setTransform(-sx, 0, 0, -sy, (W - r.x) * sx, (H - r.y) * sy); // X = W − x, Y = H − y
  else ctx.setTransform(0, -sy, sx, 0, -r.x * sx, (W - r.y) * sy); // 270°: X = y, Y = W − x
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
}

/** Zeichnet einen Bildausschnitt mit maximaler Kantenlänge in ein neues Canvas. */
export function imageToCanvas(bitmap: ImageBitmap, maxSide: number, region?: Rect | null, rot: PlanRotation = 0): HTMLCanvasElement {
  const size = rotatedSize(bitmap.width, bitmap.height, rot);
  const r = region ?? { x: 0, y: 0, w: size.width, h: size.height };
  const scale = clampRenderScale(r.w, r.h, Math.min(1, maxSide / Math.max(r.w, r.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawImageRegion(ctx, bitmap, r, canvas.width, canvas.height, rot);
  return canvas;
}

/**
 * Text einer PDF-Seite in Seitenkoordinaten (wie die Planansicht: PDF-Punkte, Ursprung oben
 * links, Seitendrehung berücksichtigt) – für die automatische Maßstabserkennung.
 */
export async function readPageText(page: PDFPageProxy, rot: PlanRotation = 0): Promise<import('./scale-detect').PageText[]> {
  const vp = pageViewport(page, rot);
  const content = await page.getTextContent();
  const out: import('./scale-detect').PageText[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const ang = Math.atan2(b, a);
    const fh = Math.hypot(c, d) || 1;
    const w = it.width || 0;
    const p0 = vp.convertToViewportPoint(e, f);
    const p1 = vp.convertToViewportPoint(e + Math.cos(ang) * w, f + Math.sin(ang) * w);
    const pu = vp.convertToViewportPoint(e - Math.sin(ang) * fh * 0.7, f + Math.cos(ang) * fh * 0.7);
    const x = (p0[0] + p1[0]) / 2 + (pu[0] - p0[0]) / 2;
    const y = (p0[1] + p1[1]) / 2 + (pu[1] - p0[1]) / 2;
    out.push({
      str: it.str,
      x,
      y,
      angle: (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI,
      width: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
      height: fh,
    });
  }
  return out;
}

/**
 * Linien einer PDF-Seite für den Punktfang: alle gezeichneten Pfade (Striche und Flächenränder,
 * keine reinen Clip-Pfade) in Plankoordinaten (Seiten- und Plandrehung berücksichtigt), nur im
 * Bereich `region`. Text und Bilder liefern keine Linien.
 */
export async function readPageSegments(page: PDFPageProxy, rot: PlanRotation = 0, region: Rect | null = null): Promise<import('./pdf-snap').PlanSeg[]> {
  const { mul, pathSegments } = await import('./pdf-snap');
  type M = [number, number, number, number, number, number];
  const OPS = pdfjs.OPS;
  const DRAW = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const list = await page.getOperatorList();
  let ctm = pageViewport(page, rot).transform as M;
  const stack: M[] = [];
  const out: import('./pdf-snap').PlanSeg[] = [];
  let pathId = 0;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as M);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>) as M);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const op = args[0] as number;
      const data = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | undefined;
      if (DRAW.has(op) && data && typeof data !== 'string' && 'length' in data) pathSegments(data, ctm, pathId++, out, region);
    }
  }
  return out;
}
