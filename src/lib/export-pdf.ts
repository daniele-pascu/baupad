import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { componentsOf, costCenterLabel, damagesOf, elementsOf, planTitle, safeFileName, type ExportFile } from './aufmass';
import { annotationsOf, contentRegion, dimGeometry, drawingSheet, isDrawingPlan, PAPER, PRINT_HEADER_MM, PRINT_MARGIN_MM, printScale, shapeToPage, unitsPerMeter } from './drawing';
import { getBlob } from './db';
import { damageNo } from './numbering';
import {
  layoutLabels,
  leaderLine,
  pathToSvg,
  isOpenShape,
  shapeAABB,
  shapePath,
  type Point,
} from './geometry';
import { canvasToBlob, closePdf, clampRenderScale, imageToCanvas, loadImageBitmap, openPdf, renderPdfRegion, renderPdfToCanvas } from './pdf';
import type { ProjectState } from './store';
import type { Component, Damage, Plan, Rect } from './types';

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
  overview: PdfExportOptions['overview'];
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

export type OverviewCorner = 'tr' | 'tl' | 'br' | 'bl';

export interface PdfExportOptions {
  planIds: string[];
  /** Übersicht des Gesamtplans bei Planausschnitten (in einem Randstreifen, verdeckt nichts) */
  overview?: { enabled: boolean; corner: OverviewCorner };
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
    overview: opts.overview,
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
  if (isDrawingPlan(plan)) {
    addDrawingPage(ctx, data, plan);
    return;
  }
  const file = data.files[plan.fileId];
  if (!file) throw new Error(`Originaldatei zu Plan ${planTitle(plan)} fehlt.`);
  const region: Rect = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const damages = damagesOf(data, plan.id);
  // Bauteilbuchstaben werden nicht mehr verwendet (Daten bleiben gespeichert, erscheinen aber nicht im Export)
  const components: ReturnType<typeof componentsOf> = [];

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
        const ov = overviewLayout(ctx, plan, region, header);
        // Sichtbaren Bereich auf Planausschnitt + Kopfstreifen (+ Streifen für die Übersicht) setzen
        const corners = [
          map({ x: Math.min(region.x, ov?.strip.x ?? Infinity), y: region.y - header }),
          map({ x: Math.max(region.x + region.w, ov ? ov.strip.x + ov.strip.w : -Infinity), y: region.y + region.h }),
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
        drawDamages(ctx, target, region, damages, components);
        if (ov) await drawOverview(ctx, target, plan, ov, await renderPdfToCanvas(jsPage, 900));
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
    const full = overviewLayout(ctx, plan, region, headerHeight(region, 1)) ? await renderPdfToCanvas(jsPage, 900) : null;
    await addRasterPage(ctx, plan, region, damages, components, canvas, 1, full);
    return;
  }

  const bytes = await getBlob(file.id);
  if (!bytes) throw new Error(`Originaldatei ${file.name} nicht gefunden.`);
  const bitmap = await loadImageBitmap(bytes, file.mimeType);
  try {
    const canvas = imageToCanvas(bitmap, 8192, region);
    const full = overviewLayout(ctx, plan, region, headerHeight(region, 72 / 150)) ? imageToCanvas(bitmap, 900, null) : null;
    // Bildpixel als 150 dpi interpretieren
    await addRasterPage(ctx, plan, region, damages, components, canvas, 72 / 150, full);
  } finally {
    bitmap.close();
  }
}

async function addRasterPage(
  ctx: Ctx,
  plan: Plan,
  region: Rect,
  damages: Damage[],
  components: Component[],
  canvas: HTMLCanvasElement,
  ptPerUnit: number,
  fullPage: HTMLCanvasElement | null = null,
) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const img = await ctx.out.embedJpg(await blob.arrayBuffer());
  const header = headerHeight(region, ptPerUnit);
  const ov = fullPage ? overviewLayout(ctx, plan, region, header) : null;
  const x0 = Math.min(region.x, ov?.strip.x ?? Infinity);
  const x1 = Math.max(region.x + region.w, ov ? ov.strip.x + ov.strip.w : -Infinity);
  const w = (x1 - x0) * ptPerUnit;
  const h = (region.h + header) * ptPerUnit;
  const page = ctx.out.addPage([w, h]);
  page.drawImage(img, { x: (region.x - x0) * ptPerUnit, y: 0, width: region.w * ptPerUnit, height: region.h * ptPerUnit });
  const map = (p: Point): Point => ({ x: (p.x - x0) * ptPerUnit, y: h - (p.y - (region.y - header)) * ptPerUnit });
  const target: Target = { page, map, textRotation: 0, ptPerUnit };
  drawHeader(ctx, plan, target, region, header);
  drawDamages(ctx, target, region, damages, components);
  if (ov && fullPage) await drawOverview(ctx, target, plan, ov, fullPage);
}

// ---------------------------------------------------------------------------
// Übersicht des Gesamtplans bei Planausschnitten

interface OverviewLayout {
  /** Randstreifen neben dem Ausschnitt (Seitenkoordinaten), über die ganze Höhe */
  strip: Rect;
  /** Position der verkleinerten Gesamtseite im Streifen */
  inset: Rect;
  /** x der Trennlinie zwischen Plan und Streifen */
  edgeX: number;
}

/** Lage der Übersicht – nur für Pläne mit Ausschnitt und wenn eingeschaltet. */
function overviewLayout(ctx: Ctx, plan: Plan, region: Rect, header: number): OverviewLayout | null {
  if (!ctx.overview?.enabled || !plan.crop) return null;
  const corner = ctx.overview.corner;
  const fullW = plan.pageWidth;
  const fullH = plan.pageHeight;
  const avail = region.h + header;
  const pad = Math.max(region.w, region.h) * 0.02;
  // Etwa ein Viertel der Ausschnittsgröße, höchstens so hoch wie die Seite
  let iw = Math.max(region.w, region.h) * 0.26;
  let ih = (iw * fullH) / fullW;
  if (ih > avail - 2 * pad - header) {
    ih = Math.max(avail - 2 * pad - header, avail * 0.3);
    iw = (ih * fullW) / fullH;
  }
  const strip: Rect = {
    x: corner.endsWith('l') ? region.x - iw - 2 * pad : region.x + region.w,
    y: region.y - header,
    w: iw + 2 * pad,
    h: avail,
  };
  const top = corner.startsWith('t');
  const inset: Rect = { x: strip.x + pad, y: top ? region.y + pad * 1.5 : region.y + region.h - pad - ih, w: iw, h: ih };
  return { strip, inset, edgeX: corner.endsWith('l') ? region.x : region.x + region.w };
}

async function drawOverview(ctx: Ctx, t: Target, plan: Plan, ov: OverviewLayout, fullPage: HTMLCanvasElement) {
  const u = 1 / t.ptPerUnit;
  // Streifen weiß abdecken (bei PDF-Seiten läge dort sonst der übrige Originalplan)
  drawRectMapped(t, ov.strip, { color: rgb(1, 1, 1) });
  t.page.drawLine({ start: t.map({ x: ov.edgeX, y: ov.strip.y }), end: t.map({ x: ov.edgeX, y: ov.strip.y + ov.strip.h }), thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
  const blob = await canvasToBlob(fullPage, 'image/jpeg', 0.85);
  const img: PDFImage = await ctx.out.embedJpg(await blob.arrayBuffer());
  const anchor = t.map({ x: ov.inset.x, y: ov.inset.y + ov.inset.h });
  t.page.drawImage(img, { x: anchor.x, y: anchor.y, width: ov.inset.w * t.ptPerUnit, height: ov.inset.h * t.ptPerUnit, rotate: degrees(t.textRotation) });
  drawRectMapped(t, ov.inset, { borderColor: rgb(0.45, 0.48, 0.52), borderWidth: 0.6 });
  // Verwendeter Ausschnitt rot umrandet (maßstäblich zur Gesamtseite)
  const c = plan.crop!;
  const sx = ov.inset.w / plan.pageWidth;
  const sy = ov.inset.h / plan.pageHeight;
  drawRectMapped(t, { x: ov.inset.x + c.x * sx, y: ov.inset.y + c.y * sy, w: c.w * sx, h: c.h * sy }, { borderColor: rgb(0.86, 0.1, 0.1), borderWidth: 1.6 });
  const fs = Math.max(6, Math.min(10, ov.inset.w * t.ptPerUnit * 0.06));
  drawTextMapped(t, clean(ctx, fitText(ctx.font, 'Gesamtplan – Ausschnitt rot', fs, ov.inset.w * t.ptPerUnit)), { x: ov.inset.x, y: ov.inset.y - fs * 0.5 * u }, fs, ctx.font, rgb(0.35, 0.38, 0.42));
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

/** Gut sichtbare Strichfarbe (Weiß wäre auf weißem Plan unsichtbar) */
const visibleHex = (hex: string) => (hex.toLowerCase() === '#ffffff' ? '#8e8e93' : hex);
/** Kontur: hell unter dunklen, dunkel unter hellen Farben */
function haloRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? rgb(0.11, 0.11, 0.12) : rgb(1, 1, 1);
}

function drawDamages(ctx: Ctx, t: Target, region: Rect, damages: Damage[], components: Component[]) {
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
    t.page.drawSvgPath(svg, { x: 0, y: 0, borderColor: haloRgb(d.color), borderWidth: stroke + 1.6, borderOpacity: 0.75 });
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
      w: ctx.bold.widthOfTextAtSize(clean(ctx, damageNo(d)), fs) * u + 2 * padX,
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
    const color = hexToRgb(visibleHex(d.color));
    drawRectMapped(t, r, { color: rgb(1, 1, 1), borderColor: color, borderWidth: stroke * 0.8, opacity: 0.92 });
    drawTextMapped(t, clean(ctx, damageNo(d)), { x: r.x + padX, y: r.y + boxH * 0.73 }, fs, ctx.bold);
  }
  // Bauteilkennzeichnungen (A, B, C …) als Kreis mit Buchstabe
  for (const c of components) {
    const radius = fs * 0.95; // in Punkten
    const center = t.map({ x: c.x, y: c.y });
    const white = c.color.toLowerCase() === '#ffffff';
    t.page.drawCircle({
      x: center.x,
      y: center.y,
      size: radius,
      color: white ? rgb(0.11, 0.11, 0.12) : rgb(1, 1, 1),
      borderColor: hexToRgb(visibleHex(c.color)),
      borderWidth: stroke * 1.3,
    });
    const letter = clean(ctx, c.letter);
    const size = fs * (letter.length > 1 ? 0.8 : 1.05);
    const tw = ctx.bold.widthOfTextAtSize(letter, size) * u;
    drawTextMapped(
      t,
      letter,
      { x: c.x - tw / 2, y: c.y + size * 0.36 * u },
      size,
      ctx.bold,
      white ? rgb(1, 1, 1) : hexToRgb(visibleHex(c.color)),
    );
  }
}

// ---------------------------------------------------------------------------
// Selbst gezeichnete Pläne

/** A3 in PDF-Punkten und Millimetern */
const A3 = { wPt: 1190.55, hPt: 841.89, wMm: 420, hMm: 297 };
const MM = 72 / 25.4;

/**
 * Gezeichneter Plan als Vektorseite im Format A3 mit Normmaßstab (z. B. 1:100).
 * Zeichnungsobjekte, Maßketten, Messungen und Bauteilbuchstaben werden als Vektoren gezeichnet.
 */
function addDrawingPage(ctx: Ctx, data: ProjectState, plan: Plan) {
  const k = unitsPerMeter(plan);
  const elements = elementsOf(data, plan.id);
  const damages = damagesOf(data, plan.id);
  // Bauteilbuchstaben werden nicht mehr verwendet (Daten bleiben gespeichert, erscheinen aber nicht im Export)
  const components: ReturnType<typeof componentsOf> = [];
  // Mit Papierformat: genau das Zeichenblatt im gewählten Maßstab; sonst (ältere Pläne) Inhalt
  // auf A3 mit passendem Normmaßstab
  const sheet = drawingSheet(plan);
  const paperFmt = plan.drawing?.paper ? PAPER[plan.drawing.paper] : null;
  const region = sheet ?? contentRegion(plan, elements, damages);
  const portrait = paperFmt ? paperFmt.h > paperFmt.w : region.h > region.w;
  const W = paperFmt ? paperFmt.w * MM : portrait ? A3.hPt : A3.wPt;
  const H = paperFmt ? paperFmt.h * MM : portrait ? A3.wPt : A3.hPt;
  const margin = (paperFmt ? PRINT_MARGIN_MM : 12) * MM;
  const headerPt = (paperFmt ? PRINT_HEADER_MM : 16) * MM;
  const avail = { w: (W - 2 * margin) / MM, h: (H - 2 * margin - headerPt) / MM };
  const scaleN = paperFmt ? (plan.drawing?.scale ?? 100) : printScale({ w: region.w / k, h: region.h / k }, avail);
  // Seiteneinheit (1/k m) → Punkte auf dem Papier
  const u = (1000 / k / scaleN) * MM;
  const ox = (W - region.w * u) / 2;
  const oy = margin + headerPt + (H - 2 * margin - headerPt - region.h * u) / 2;
  const page = ctx.out.addPage([W, H]);
  /** Papierkoordinaten (pt, y nach unten) → PDF */
  const pdf = (q: Point): Point => ({ x: q.x, y: H - q.y });
  const paper = (p: Point): Point => ({ x: ox + (p.x - region.x) * u, y: oy + (p.y - region.y) * u });
  const map = (p: Point): Point => pdf(paper(p));
  const target: Target = { page, map, textRotation: 0, ptPerUnit: u };

  // Kopf: „Aufmaßplan <Nr.>“ und Maßstab
  const title = clean(ctx, `Aufmaßplan ${plan.planNumber || plan.planName}`.trim());
  page.drawText(fitText(ctx.bold, title, 16, W - 2 * margin - 160), { x: margin, y: H - margin - 16, size: 16, font: ctx.bold, color: rgb(0.1, 0.1, 0.12) });
  const scaleText = `Maßstab 1:${scaleN} (${paperFmt ? paperFmt.label.replace('format', '') : 'A3'})`;
  page.drawText(clean(ctx, scaleText), {
    x: W - margin - ctx.font.widthOfTextAtSize(scaleText, 10),
    y: H - margin - 14,
    size: 10,
    font: ctx.font,
    color: rgb(0.3, 0.33, 0.38),
  });
  page.drawLine({ start: { x: margin, y: H - margin - headerPt + 6 }, end: { x: W - margin, y: H - margin - headerPt + 6 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });

  // Zeichnungsobjekte
  const dimColor = rgb(0.16, 0.3, 0.5);
  for (const e of elements) {
    const shape = shapeToPage(e.shape, k);
    const color = hexToRgb(visibleHex(e.color));
    if (e.type === 'text') {
      const size = shape.h * u;
      const at = map({ x: shape.x, y: shape.y + shape.h * 0.82 });
      page.drawText(clean(ctx, e.text ?? ''), { x: at.x, y: at.y, size, font: ctx.font, color, rotate: degrees(-(shape.rotation ?? 0)) });
      continue;
    }
    const svg = pathToSvg(shapePath(shape), (p) => {
      const q = map(p);
      return { x: q.x, y: -q.y };
    });
    page.drawSvgPath(svg, { x: 0, y: 0, borderColor: color, borderWidth: e.type === 'dimension' ? 0.6 : 1.1 });
  }
  // Maßketten
  const fs = 7.5;
  const drawRotatedText = (text: string, center: Point, angle: number) => {
    const t = clean(ctx, text);
    const w = ctx.bold.widthOfTextAtSize(t, fs);
    const a = (angle * Math.PI) / 180;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const down = { x: -Math.sin(a), y: Math.cos(a) };
    const start = pdf({ x: center.x - (d.x * w) / 2 + down.x * fs * 0.35, y: center.y - (d.y * w) / 2 + down.y * fs * 0.35 });
    page.drawText(t, { x: start.x, y: start.y, size: fs, font: ctx.bold, color: dimColor, rotate: degrees(-angle) });
  };
  for (const e of elements) {
    const { dims, labels } = annotationsOf(e);
    for (const dm of dims) {
      const a = paper({ x: dm.a.x * k, y: dm.a.y * k });
      const b = paper({ x: dm.b.x * k, y: dm.b.y * k });
      if (Math.hypot(b.x - a.x, b.y - a.y) < 12) continue;
      const off = dm.inline ? 0 : 9;
      const g = dimGeometry(a, b, dm.side, off);
      if (!dm.inline) {
        const ext = (p: Point, q: Point) =>
          page.drawLine({ start: pdf({ x: p.x + g.nx * 2, y: p.y + g.ny * 2 }), end: pdf({ x: q.x + g.nx * 2.5, y: q.y + g.ny * 2.5 }), thickness: 0.35, color: dimColor });
        ext(a, g.a2);
        ext(b, g.b2);
        page.drawLine({ start: pdf(g.a2), end: pdf(g.b2), thickness: 0.45, color: dimColor });
        const ang = Math.atan2(g.b2.y - g.a2.y, g.b2.x - g.a2.x) + Math.PI / 4;
        for (const p of [g.a2, g.b2]) {
          const tx = Math.cos(ang) * 2.2;
          const ty = Math.sin(ang) * 2.2;
          page.drawLine({ start: pdf({ x: p.x - tx, y: p.y - ty }), end: pdf({ x: p.x + tx, y: p.y + ty }), thickness: 0.8, color: dimColor });
        }
      }
      const textOff = dm.inline ? 5 : 4;
      drawRotatedText(dm.text, { x: g.mid.x + g.nx * textOff, y: g.mid.y + g.ny * textOff }, g.angle);
    }
    for (const l of labels) drawRotatedText(l.text, paper({ x: l.at.x * k, y: l.at.y * k }), 0);
  }
  // Messungen und Bauteilbuchstaben darüber
  drawDamages(ctx, target, region, damages, components);
  // Maßstabsleiste unten links im Rand: runde Länge, ca. 40–60 mm auf dem Papier
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const barM = nice.find((m) => (m * 1000) / scaleN >= 35) ?? 200;
  const barPt = ((barM * 1000) / scaleN) * MM;
  const bx = margin;
  const by = margin * 0.45;
  const seg = 4;
  for (let i = 0; i < seg; i++)
    page.drawRectangle({ x: bx + (barPt / seg) * i, y: by, width: barPt / seg, height: 3, color: i % 2 ? rgb(1, 1, 1) : rgb(0.15, 0.15, 0.17), borderColor: rgb(0.15, 0.15, 0.17), borderWidth: 0.5 });
  page.drawText('0', { x: bx - 2, y: by + 5, size: 6.5, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
  const lbl = `${String(barM).replace('.', ',')} m`;
  page.drawText(lbl, { x: bx + barPt - ctx.font.widthOfTextAtSize(lbl, 6.5) / 2, y: by + 5, size: 6.5, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
}
