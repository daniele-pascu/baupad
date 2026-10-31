/**
 * Mängelplan: Pläne je Baustelle (Bild ohne Maßstab) mit nummerierten Markierungen – Pins, Formen, Text –
 * je Markierung Art (Mangel, Ausbesserung, Hinweis, Erledigt), Titel, Beschreibung und Fotos aus der
 * Fotodokumentation. Grundlage für ein Angebot oder eine Mängelliste als PDF.
 */
import { deleteDefectMark, getDefectPlan, getDefectPlanImage, listDefectMarks, listDefectPlans, putDefectPlanImage, saveDefectMark, saveDefectPlan } from './db';
import { uuid } from './ids';
import { canvasToBlob, closePdf, imageToCanvas, loadImageBitmap, openPdf, renderPdfToCanvas } from './pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { photoSiteKey } from './photos';
import type { DefectKind, DefectMark, DefectPlan, MarkShape, PhotoSite } from './types';

export const DEFECT_COLOR = '#d6242b';

export const KINDS: { id: DefectKind; label: string; color: string }[] = [
  { id: 'mangel', label: 'Mangel', color: '#d6242b' },
  { id: 'ausbesserung', label: 'Ausbesserung', color: '#2f80ed' },
  { id: 'hinweis', label: 'Hinweis', color: '#f2a900' },
  { id: 'erledigt', label: 'Erledigt', color: '#1f9d55' },
];
export const kindInfo = (k: DefectKind) => KINDS.find((x) => x.id === k) ?? KINDS[0];

/** Farben der Werkzeugleiste (Art-Farben plus Schwarz) */
export const MARK_COLORS = ['#d6242b', '#2f80ed', '#f2a900', '#1f9d55', '#111111'];

export const SHAPES: { id: MarkShape; label: string }[] = [
  { id: 'pin', label: 'Pin' },
  { id: 'rect', label: 'Rechteck' },
  { id: 'ellipse', label: 'Kreis' },
  { id: 'line', label: 'Linie' },
  { id: 'freehand', label: 'Freihand' },
  { id: 'text', label: 'Text' },
];

/** Schlüssel der Baustelle, gleich wie in der Fotodokumentation (p:<Projekt> bzw. n:<Name>) */
export const defectSiteKey = (p: Pick<DefectPlan, 'projectId' | 'siteName'>) => photoSiteKey(p);

/** Grundbild: längste Kante in Pixeln (Übersicht); beim Zoomen wird aus dem PDF scharf nachgerendert */
export const PLAN_MAX = 3200;
/** Auflösung des Plans im PDF-Export (aus dem Original-PDF, sonst das Grundbild) */
export const EXPORT_MAX = 4200;
const THUMB_MAX = 480;

/**
 * Plan aus PDF (erste Seite) oder Bild als JPEG übernehmen – ohne Maßstab. Bei PDF bleibt die Originaldatei
 * erhalten, damit die Ansicht beim Zoomen und der Export so scharf sind wie in Aufmaß & Abrechnung.
 */
export async function importPlanImage(file: File): Promise<{ data: ArrayBuffer; thumb: ArrayBuffer; width: number; height: number; pdf?: ArrayBuffer }> {
  const buf = await file.arrayBuffer();
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let canvas: HTMLCanvasElement;
  if (isPdf) {
    const doc = await openPdf(buf.slice(0));
    try {
      const page = await doc.getPage(1);
      canvas = await renderPdfToCanvas(page, PLAN_MAX);
    } finally {
      await closePdf(doc);
    }
  } else {
    const bmp = await loadImageBitmap(buf, file.type || 'image/jpeg');
    canvas = imageToCanvas(bmp, PLAN_MAX);
  }
  const data = await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer();
  const thumb = await (await canvasToBlob(imageToCanvas(await createImageBitmap(canvas), THUMB_MAX), 'image/jpeg', 0.8)).arrayBuffer();
  return { data, thumb, width: canvas.width, height: canvas.height, pdf: isPdf ? buf : undefined };
}

/** Geöffnete Original-PDFs je Plan (höchstens zwei zugleich im Speicher) */
const pdfCache = new Map<string, Promise<PDFDocumentProxy>>();
export function openPlanPdf(planId: string): Promise<PDFDocumentProxy | null> {
  let p = pdfCache.get(planId);
  if (!p) {
    p = (async () => {
      const img = await getDefectPlanImage(planId);
      if (!img?.pdf) throw new Error('no-pdf');
      return openPdf(img.pdf.slice(0));
    })();
    p.catch(() => pdfCache.delete(planId));
    pdfCache.set(planId, p);
    while (pdfCache.size > 2) {
      const [oldest, old] = pdfCache.entries().next().value!;
      pdfCache.delete(oldest);
      old.then((d) => closePdf(d)).catch(() => {});
    }
  }
  return p.catch((e: Error) => {
    if (e.message === 'no-pdf') return null;
    throw e;
  });
}

/** Plan als JPEG für den Export: aus dem Original-PDF in hoher Auflösung, sonst das gespeicherte Grundbild */
export async function planRaster(planId: string, maxSide = EXPORT_MAX): Promise<ArrayBuffer | null> {
  const img = await getDefectPlanImage(planId);
  if (!img) return null;
  const doc = await openPlanPdf(planId);
  if (!doc) return img.data;
  const canvas = await renderPdfToCanvas(await doc.getPage(1), maxSide);
  return (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer();
}

export async function createDefectPlan(site: PhotoSite, title: string, file: File): Promise<DefectPlan> {
  const img = await importPlanImage(file);
  const now = Date.now();
  const plan: DefectPlan = {
    id: uuid(),
    companyId: null,
    projectId: site.projectId,
    siteName: site.name,
    siteNumber: site.number,
    siteAddress: site.address,
    title: title.trim() || file.name.replace(/\.[^.]+$/, ''),
    width: img.width,
    height: img.height,
    createdAt: now,
    updatedAt: now,
  };
  await putDefectPlanImage({ id: plan.id, data: img.data, thumb: img.thumb, pdf: img.pdf });
  await saveDefectPlan(plan);
  return plan;
}

export async function renameDefectPlan(id: string, title: string): Promise<void> {
  const p = await getDefectPlan(id);
  if (!p) return;
  await saveDefectPlan({ ...p, title: title.trim() || p.title, updatedAt: Date.now() });
}

export const planImage = (id: string) => getDefectPlanImage(id);
export const plansOfSite = async (key: string) => (await listDefectPlans()).filter((p) => defectSiteKey(p) === key).sort((a, b) => a.createdAt - b.createdAt);

export function newMark(planId: string, no: number, shape: MarkShape, color: string, points: { x: number; y: number }[], kind: DefectKind = 'mangel'): DefectMark {
  const now = Date.now();
  return { id: uuid(), planId, no, shape, color, points, text: '', kind, title: '', description: '', photoIds: [], createdAt: now, updatedAt: now };
}

export const loadMarks = async (planId: string) => (await listDefectMarks(planId)).sort((a, b) => a.no - b.no);
export const putMark = (m: DefectMark) => saveDefectMark({ ...m, updatedAt: Date.now() });
export const removeMark = (id: string) => deleteDefectMark(id);

/** Markierungen neu durchnummerieren (nach Löschen), Reihenfolge nach bisheriger Nummer */
export async function renumber(planId: string): Promise<DefectMark[]> {
  const marks = await loadMarks(planId);
  const out: DefectMark[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i].no === i + 1 ? marks[i] : { ...marks[i], no: i + 1, updatedAt: Date.now() };
    if (m !== marks[i]) await saveDefectMark(m);
    out.push(m);
  }
  return out;
}

export * from './defect-geom';
