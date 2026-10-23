import { getThumb, putThumb } from './db';
import { canvasToBlob, getImageBitmap, getPdfDocument, imageToCanvas, renderPdfToCanvas } from './pdf';
import type { Plan, Rect, SourceFile } from './types';

/** Rendert eine Seite bzw. einen Ausschnitt einer Originaldatei. */
export async function renderSource(
  file: Pick<SourceFile, 'id' | 'kind' | 'mimeType'>,
  pageIndex: number,
  maxSide: number,
  region?: Rect | null,
): Promise<HTMLCanvasElement> {
  if (file.kind === 'pdf') {
    const doc = await getPdfDocument(file.id);
    const page = await doc.getPage(pageIndex + 1);
    return renderPdfToCanvas(page, maxSide, region);
  }
  const bitmap = await getImageBitmap(file.id, file.mimeType);
  return imageToCanvas(bitmap, maxSide, region);
}

const pending = new Map<string, Promise<Blob>>();

/** Vorschaubild eines Plans (zwischengespeichert, nur lokal). */
export function planThumb(plan: Plan, file: SourceFile): Promise<Blob> {
  const key = `${plan.id}:${JSON.stringify(plan.crop)}`;
  let p = pending.get(key);
  if (p) return p;
  p = (async () => {
    const cached = await getThumb(plan.id);
    if (cached && thumbMatches(plan)) return cached;
    const canvas = await renderSource(file, plan.pageIndex, 480, plan.crop);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
    await putThumb(plan.id, plan.projectId, blob);
    localStorage.setItem(`thumbCrop:${plan.id}`, JSON.stringify(plan.crop));
    return blob;
  })();
  const done = () => void pending.delete(key);
  p.then(done, done);
  pending.set(key, p);
  return p;
}

function thumbMatches(plan: Plan): boolean {
  return localStorage.getItem(`thumbCrop:${plan.id}`) === JSON.stringify(plan.crop);
}
