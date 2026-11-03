import { getThumb, putThumb } from './db';
import { canvasToBlob, getImageBitmap, getPdfDocument, imageToCanvas, renderPdfToCanvas } from './pdf';
import type { Plan, PlanRotation, Rect, SourceFile } from './types';

/** Rendert eine Seite bzw. einen Ausschnitt einer Originaldatei. */
export async function renderSource(
  file: Pick<SourceFile, 'id' | 'kind' | 'mimeType'>,
  pageIndex: number,
  maxSide: number,
  region?: Rect | null,
  rot: PlanRotation = 0,
): Promise<HTMLCanvasElement> {
  if (file.kind === 'pdf') {
    const doc = await getPdfDocument(file.id);
    const page = await doc.getPage(pageIndex + 1);
    return renderPdfToCanvas(page, maxSide, region, rot);
  }
  const bitmap = await getImageBitmap(file.id, file.mimeType);
  return imageToCanvas(bitmap, maxSide, region, rot);
}

const pending = new Map<string, Promise<Blob>>();
/** Vorschaubilder nacheinander erzeugen – parallel öffnet das iPad sonst viele große PDFs zugleich */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const r = queue.then(job, job);
  queue = r.catch(() => {});
  return r;
}

/** Vorschaubild eines Plans (zwischengespeichert, nur lokal). */
export function planThumb(plan: Plan, file: SourceFile): Promise<Blob> {
  const key = `${plan.id}:${thumbKey(plan)}`;
  let p = pending.get(key);
  if (p) return p;
  p = (async () => {
    const cached = await getThumb(plan.id);
    if (cached && thumbMatches(plan)) return cached;
    const blob = await enqueue(async () => {
      const canvas = await renderSource(file, plan.pageIndex, 480, plan.crop, plan.rotation);
      try {
        return await canvasToBlob(canvas, 'image/jpeg', 0.8);
      } finally {
        canvas.width = 0; // Safari: Zeichenfläche sofort freigeben
        canvas.height = 0;
      }
    });
    await putThumb(plan.id, plan.projectId, blob);
    localStorage.setItem(`thumbCrop:${plan.id}`, thumbKey(plan));
    return blob;
  })();
  const done = () => void pending.delete(key);
  p.then(done, done);
  pending.set(key, p);
  return p;
}

/** Ausschnitt und Drehung bestimmen das Vorschaubild (ungedreht wie bisher: nur der Ausschnitt) */
const thumbKey = (plan: Plan) => JSON.stringify(plan.crop) + (plan.rotation ? `@${plan.rotation}` : '');

function thumbMatches(plan: Plan): boolean {
  return localStorage.getItem(`thumbCrop:${plan.id}`) === thumbKey(plan);
}
