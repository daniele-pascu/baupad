import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { costCenterLabel, damagesOf, planTitle, safeFileName, type ExportFile } from './aufmass';
import { getBlob } from './db';
import {
  layoutLabels,
  leaderLine,
  pathToSvg,
  isOpenShape,
  shapeAABB,
  shapePath,
  type Point,
} from './geometry';
import { canvasToBlob, closePdf, clampRenderScale, imageToCanvas, loadImageBitmap, openPdf, renderPdfRegion } from './pdf';
import type { ProjectState } from './store';
import type { Damage, Plan, Rect } from './types';

/**
 * PDF-Export bearbeiteter Pläne.
 *
 * PDF-Pläne: Die Originalseite wird unverändert (vektoriell) übernommen; Markierungen,
 * Nummern und Plankopf werden als Vektorgrafik darübergelegt. Die Seite wird oben um einen
 * Streifen für den Plankopf erweitert, damit kein Planinhalt verdeckt wird.
 * Bildpläne (und PDFs, die sich nicht verändern lassen, z. B. verschlüsselte) werden als
 * hochauflösendes Bild eingebettet.
 * Die Originaldateien bleiben unverändert.
 */

interface Ctx {
  out: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  charset: Set<number>;
  libDocs: Map<string, PDFDocument | null>;
  jsDocs: Map<string, PDFDocumentProxy>;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Entfernt Zeichen, die die Standardschrift nicht darstellen kann. */
function clean(ctx: Ctx, s: string): string {
  return [...s.replace(/[–—]/g, '-')]
    .map((ch) => (ctx.charset.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** Abbildung Seitenkoordinaten → PDF-Benutzerkoordinaten für eine Ausgabeseite. */
interface Target {
  page: PDFPage;
  map: (p: Point) => Point;
  /** Textdrehung in Grad, damit Text in Leserichtung erscheint */
  textRotation: number;
  /** PDF-Punkte je Seiteneinheit */
  ptPerUnit: number;
}

export interface PdfExportOptions {
  planIds: string[];
}

export async function exportPlansPdf(data: ProjectState, opts: PdfExportOptions): Promise<ExportFile> {
  const out = await PDFDocument.create();
  out.setTitle('Aufmaßplan');
  out.setCreator('BauPad');
  out.setProducer('BauPad');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = {
    out,
    font,
    bold,
    charset: new Set(font.getCharacterSet()),
    libDocs: new Map(),
    jsDocs: new Map(),
  };
  try {
    for (const planId of opts.planIds) {
      const plan = data.plans[planId];
      if (!plan || plan.deletedAt) continue;
      await addPlanPage(ctx, data, plan);
    }
  } finally {
    for (const d of ctx.jsDocs.values()) void closePdf(d);
  }
  if (!out.getPageCount()) throw new Error('Keine Pläne ausgewählt.');
  const bytes = await out.save();
  const plans = opts.planIds.map((id) => data.plans[id]).filter(Boolean);
  const cc = plans.length ? data.costCenters[plans[0].costCenterId] : undefined;
  const sameCc = plans.every((p) => p.costCenterId === plans[0]?.costCenterId);
  const name =
    plans.length === 1
      ? safeFileName(data.project.name, costCenterLabel(cc), plans[0].planNumber || plans[0].planName, 'Plan')
      : safeFileName(data.project.name, sameCc ? (costCenterLabel(cc)) : '', 'Plaene');
  return { name: `${name}.pdf`, data: bytes, mimeType: 'application/pdf' };
}

async function addPlanPage(ctx: Ctx, data: ProjectState, plan: Plan) {
  const file = data.files[plan.fileId];
  if (!file) throw new Error(`Originaldatei zu Plan ${planTitle(plan)} fehlt.`);
  const region: Rect = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const damages = damagesOf(data, plan.id);

  if (file.kind === 'pdf') {
    const bytes = await getBlob(file.id);
    if (!bytes) throw new Error(`Originaldatei ${file.name} nicht gefunden.`);
    let jsDoc = ctx.jsDocs.get(file.id);
    if (!jsDoc) {
      jsDoc = await openPdf(bytes);
      ctx.jsDocs.set(file.id, jsDoc);
    }
    const jsPage = await jsDoc.getPage(plan.pageIndex + 1);
    if (!ctx.libDocs.has(file.id)) {
      let libDoc: PDFDocument | null = null;
      try {
        libDoc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      } catch {
        libDoc = null; // z. B. verschlüsselt → Bild-Export
      }
      ctx.libDocs.set(file.id, libDoc);
    }
    const libDoc = ctx.libDocs.get(file.id);
    if (libDoc) {
      const before = ctx.out.getPageCount();
      try {
        const [page] = await ctx.out.copyPages(libDoc, [plan.pageIndex]);
        ctx.out.addPage(page);
        const viewport = jsPage.getViewport({ scale: 1 });
        const header = headerHeight(region, 1);
        const map = (p: Point): Point => {
          const [x, y] = viewport.convertToPdfPoint(p.x, p.y);
          return { x, y };
        };
        // Sichtbaren Bereich auf Planausschnitt + Kopfstreifen setzen
        const corners = [
          map({ x: region.x, y: region.y - header }),
          map({ x: region.x + region.w, y: region.y + region.h }),
        ];
        const box = {
          x: Math.min(corners[0].x, corners[1].x),
          y: Math.min(corners[0].y, corners[1].y),
          w: Math.abs(corners[0].x - corners[1].x),
          h: Math.abs(corners[0].y - corners[1].y),
        };
        page.setMediaBox(box.x, box.y, box.w, box.h);
        page.setCropBox(box.x, box.y, box.w, box.h);
        page.setTrimBox(box.x, box.y, box.w, box.h);
        page.setBleedBox(box.x, box.y, box.w, box.h);
        page.setArtBox(box.x, box.y, box.w, box.h);
        const target: Target = { page, map, textRotation: page.getRotation().angle, ptPerUnit: 1 };
        drawHeader(ctx, plan, target, region, header);
        drawDamages(ctx, target, region, damages);
        return;
      } catch (e) {
        console.warn('Vektor-Export nicht möglich, verwende Bild-Export', e);
        // eine evtl. bereits hinzugefügte, unvollständige Seite entfernen
        if (ctx.out.getPageCount() > before) ctx.out.removePage(before);
      }
    }
    // Bild-Export für nicht veränderbare PDFs: 200 dpi
    const scale = clampRenderScale(region.w, region.h, 200 / 72);
    const canvas = document.createElement('canvas');
    await renderPdfRegion(jsPage, canvas, region, scale).promise;
    await addRasterPage(ctx, plan, region, damages, canvas, 1);
    return;
  }

  const bytes = await getBlob(file.id);
  if (!bytes) throw new Error(`Originaldatei ${file.name} nicht gefunden.`);
  const bitmap = await loadImageBitmap(bytes, file.mimeType);
  try {
    const canvas = imageToCanvas(bitmap, 8192, region);
    // Bildpixel als 150 dpi interpretieren
    await addRasterPage(ctx, plan, region, damages, canvas, 72 / 150);
  } finally {
    bitmap.close();
  }
}

async function addRasterPage(
  ctx: Ctx,
  plan: Plan,
  region: Rect,
  damages: Damage[],
  canvas: HTMLCanvasElement,
  ptPerUnit: number,
) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const img = await ctx.out.embedJpg(await blob.arrayBuffer());
  const header = headerHeight(region, ptPerUnit);
  const w = region.w * ptPerUnit;
  const h = (region.h + header) * ptPerUnit;
  const page = ctx.out.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: region.h * ptPerUnit });
  const map = (p: Point): Point => ({ x: (p.x - region.x) * ptPerUnit, y: h - (p.y - (region.y - header)) * ptPerUnit });
  const target: Target = { page, map, textRotation: 0, ptPerUnit };
  drawHeader(ctx, plan, target, region, header);
  drawDamages(ctx, target, region, damages);
}

/** Schriftgröße der Nummern in PDF-Punkten, abhängig von der Plangröße. */
function labelFontPt(region: Rect, ptPerUnit: number): number {
  const minSide = Math.min(region.w, region.h) * ptPerUnit;
  return Math.max(6, Math.min(16, minSide * 0.011));
}

/** Höhe des Kopfstreifens in Seiteneinheiten. */
function headerHeight(region: Rect, ptPerUnit: number): number {
  return (labelFontPt(region, ptPerUnit) * 2.4) / ptPerUnit;
}

function drawRectMapped(t: Target, r: Rect, opts: { color?: ReturnType<typeof rgb>; borderColor?: ReturnType<typeof rgb>; borderWidth?: number; opacity?: number }) {
  const a = t.map({ x: r.x, y: r.y });
  const b = t.map({ x: r.x + r.w, y: r.y + r.h });
  t.page.drawRectangle({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
    color: opts.color,
    borderColor: opts.borderColor,
    borderWidth: opts.borderWidth,
    opacity: opts.opacity,
  });
}

function drawTextMapped(t: Target, text: string, at: Point, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.12)) {
  const p = t.map(at);
  t.page.drawText(text, { x: p.x, y: p.y, size, font, color, rotate: degrees(t.textRotation) });
}

/** Kopfstreifen: nur „Aufmaßplan <Plannummer>“. */
function drawHeader(ctx: Ctx, plan: Plan, t: Target, region: Rect, header: number) {
  const u = 1 / t.ptPerUnit; // Seiteneinheiten je Punkt
  const fs = labelFontPt(region, t.ptPerUnit);
  const strip = { x: region.x, y: region.y - header, w: region.w, h: header };
  drawRectMapped(t, strip, { color: rgb(1, 1, 1) });
  const titleSize = fs * 1.3;
  const title = clean(ctx, `Aufmaßplan ${plan.planNumber || plan.planName}`.trim());
  const maxW = region.w * t.ptPerUnit - 2 * fs * 0.8;
  drawTextMapped(t, fitText(ctx.bold, title, titleSize, maxW), { x: region.x + fs * 0.8 * u, y: strip.y + fs * 1.65 * u }, titleSize, ctx.bold);
}

function drawDamages(ctx: Ctx, t: Target, region: Rect, damages: Damage[]) {
  const u = 1 / t.ptPerUnit;
  const fs = labelFontPt(region, t.ptPerUnit);
  const stroke = Math.max(0.8, fs * 0.14);
  // Formen
  for (const d of damages) {
    const color = hexToRgb(d.color);
    const svg = pathToSvg(shapePath(d.shape), (p) => {
      const q = t.map(p);
      return { x: q.x, y: -q.y };
    });
    t.page.drawSvgPath(svg, {
      x: 0,
      y: 0,
      color: isOpenShape(d.shape) ? undefined : color,
      opacity: 0.12,
      borderColor: color,
      borderWidth: stroke,
      borderOpacity: 1,
    });
  }
  // Nummern
  const padX = fs * 0.35 * u;
  const boxH = fs * 1.35 * u;
  const labels = layoutLabels(
    damages.map((d) => ({
      id: d.id,
      bounds: shapeAABB(d.shape),
      shape: d.shape,
      w: ctx.bold.widthOfTextAtSize(String(d.number), fs) * u + 2 * padX,
      h: boxH,
      offset: d.labelOffset,
    })),
    fs * 0.25 * u,
    { area: region },
  );
  // Verbindungslinien zuerst, damit sie unter den Nummern liegen
  for (const d of damages) {
    const line = leaderLine(d.shape, labels.get(d.id)!, fs * 0.4 * u);
    if (line) t.page.drawLine({ start: t.map(line.from), end: t.map(line.to), thickness: stroke * 0.7, color: hexToRgb(d.color), opacity: 0.95 });
  }
  for (const d of damages) {
    const r = labels.get(d.id)!;
    const color = hexToRgb(d.color);
    drawRectMapped(t, r, { color: rgb(1, 1, 1), borderColor: color, borderWidth: stroke * 0.8, opacity: 0.92 });
    drawTextMapped(t, String(d.number), { x: r.x + padX, y: r.y + boxH * 0.73 }, fs, ctx.bold);
  }
}
