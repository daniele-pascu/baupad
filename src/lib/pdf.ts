import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getBlob } from './db';
import type { Rect } from './types';

/*
 * PDF-Darstellung mit pdf.js. Es wird der „legacy“-Build verwendet, damit auch ältere
 * iPads/iPhones unterstützt werden. Worker, Schriften, CMaps und WASM-Decoder werden mit
 * der App ausgeliefert und stehen damit offline zur Verfügung.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = new URL('pdfjs/', document.baseURI).href;

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

/** Größe der Seite in Seitenkoordinaten (PDF-Punkte, Seitendrehung berücksichtigt). */
export function pageSize(page: PDFPageProxy): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
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
): RenderJob {
  const width = Math.max(1, Math.round(region.w * scale));
  const height = Math.max(1, Math.round(region.h * scale));
  canvas.width = width;
  canvas.height = height;
  const viewport = page.getViewport({ scale, offsetX: -region.x * scale, offsetY: -region.y * scale });
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
): Promise<HTMLCanvasElement> {
  const size = pageSize(page);
  const r = region ?? { x: 0, y: 0, w: size.width, h: size.height };
  const scale = clampRenderScale(r.w, r.h, maxSide / Math.max(r.w, r.h));
  const canvas = document.createElement('canvas');
  await renderPdfRegion(page, canvas, r, scale).promise;
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

/** Zeichnet einen Bildausschnitt mit maximaler Kantenlänge in ein neues Canvas. */
export function imageToCanvas(bitmap: ImageBitmap, maxSide: number, region?: Rect | null): HTMLCanvasElement {
  const r = region ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const scale = clampRenderScale(r.w, r.h, Math.min(1, maxSide / Math.max(r.w, r.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}
