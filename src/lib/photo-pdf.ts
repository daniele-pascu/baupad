import { PDFImage } from 'pdf-lib';
import type { ExportFile } from './aufmass';
import { safeFileName } from './aufmass';
import type { CompanyLogo } from './company';
import { clean, type Ctx, fit, footers, header, INK, LINE, M, MUTED, setup } from './crew-pdf';
import { dateTimeLabel, groupPhotos, type PhotoGroupMode } from './photos';
import type { Photo, PhotoSite } from './types';

export type PhotoPdfQuality = 'klein' | 'mittel' | 'hoch';
export interface PhotoPdfOptions {
  company: string;
  logo: CompanyLogo | null;
  /** Logo rechts oben (sonst links) */
  logoRight: boolean;
  perPage: 1 | 2 | 4 | 6;
  landscape: boolean;
  quality: PhotoPdfQuality;
  showDate: boolean;
  showUser: boolean;
  showDescription: boolean;
  numbering: boolean;
  /** Überschrift je Kalenderwoche (jede Woche beginnt auf einer neuen Seite) */
  groupBy: 'none' | PhotoGroupMode;
  /** älteste zuerst (sonst neueste zuerst) */
  oldestFirst: boolean;
  title?: string;
}

export const DEFAULT_PDF_OPTIONS: Omit<PhotoPdfOptions, 'company' | 'logo'> = {
  logoRight: true,
  perPage: 4,
  landscape: false,
  quality: 'mittel',
  showDate: true,
  showUser: true,
  showDescription: true,
  numbering: true,
  groupBy: 'week',
  oldestFirst: true,
};

/** Bilddaten eines Fotos (JPEG oder PNG) für die gewählte Qualität */
export type ImageLoader = (photo: Photo, quality: PhotoPdfQuality) => Promise<Uint8Array | null>;

const A4: [number, number] = [595.28, 841.89];
const GAP = 12;

function layout(perPage: number, landscape: boolean): { cols: number; rows: number } {
  const map: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3] };
  const [cols, rows] = map[perPage] ?? [2, 2];
  return landscape && perPage > 1 ? { cols: rows, rows: cols } : { cols, rows };
}

async function embed(ctx: Ctx, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await ctx.doc.embedPng(bytes);
    return await ctx.doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** Zeilenumbruch auf eine Breite; höchstens `maxLines` Zeilen (letzte wird gekürzt) */
function wrap(ctx: Ctx, text: string, size: number, max: number, maxLines: number): string[] {
  const words = clean(ctx, text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(t, size) <= max) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    return [...lines.slice(0, maxLines - 1), fit(ctx.font, rest, size, max)];
  }
  return lines;
}

/**
 * Fotodokumentation als PDF: Kopf mit Logo (links oder rechts), Baustelle und Zeitraum; Fotos im Raster
 * (1, 2, 4 oder 6 je Seite) mit Nummer, Datum/Uhrzeit, Aufgenommen von und Beschreibung; wahlweise je KW/Tag/Monat
 * eine Überschrift und eine neue Seite.
 */
export async function photoPdf(site: Pick<PhotoSite, 'name' | 'number' | 'address'>, photos: Photo[], load: ImageLoader, opts: PhotoPdfOptions): Promise<ExportFile> {
  const ctx = await setup({ logo: opts.logo });
  const size: [number, number] = opts.landscape ? [A4[1], A4[0]] : A4;
  const { cols, rows } = layout(opts.perPage, opts.landscape);
  const sorted = [...photos].sort((a, b) => (opts.oldestFirst ? a.takenAt - b.takenAt : b.takenAt - a.takenAt));
  const groups = opts.groupBy === 'none' ? [{ key: 'alle', title: '', photos: sorted }] : groupPhotos(sorted, opts.groupBy).map((g) => ({ key: g.key, title: g.title, photos: sorted.filter((p) => g.days.some((d) => d.photos.includes(p))) }));
  if (opts.groupBy !== 'none' && opts.oldestFirst) groups.reverse();
  const days = sorted.map((p) => p.day).sort();
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const period = days.length ? (days[0] === days[days.length - 1] ? fmt(days[0]) : `${fmt(days[0])} – ${fmt(days[days.length - 1])}`) : '';
  const title = opts.title?.trim() || 'Fotodokumentation';
  const sub = [[site.number, site.name].filter(Boolean).join(' · '), site.address, period ? `${period} · ${sorted.length} ${sorted.length === 1 ? 'Foto' : 'Fotos'}` : ''].filter(Boolean).join('  |  ');

  const captionLines = (opts.showDate || opts.showUser || opts.numbering ? 1 : 0) + (opts.showDescription ? (opts.perPage === 1 ? 3 : 2) : 0);
  const captionH = captionLines ? captionLines * 11 + 6 : 0;
  let n = 0;
  for (const g of groups) {
    let page = ctx.doc.addPage(size);
    let top = header(ctx, page, title, sub, opts.company, opts.logoRight);
    if (g.title) {
      page.drawText(clean(ctx, g.title), { x: M, y: top - 12, size: 12, font: ctx.bold, color: INK });
      top -= 24;
    }
    const cellW = (size[0] - 2 * M - GAP * (cols - 1)) / cols;
    const cellH = (top - 34 - GAP * (rows - 1)) / rows;
    const imgH = cellH - captionH;
    let slot = 0;
    for (const p of g.photos) {
      if (slot === cols * rows) {
        page = ctx.doc.addPage(size);
        const t = header(ctx, page, title, sub, opts.company, opts.logoRight);
        if (g.title) page.drawText(clean(ctx, `${g.title} (Fortsetzung)`), { x: M, y: t - 12, size: 12, font: ctx.bold, color: INK });
        slot = 0;
      }
      n++;
      const c = slot % cols;
      const r = Math.floor(slot / cols);
      const x = M + c * (cellW + GAP);
      const yTop = top - r * (cellH + GAP);
      // Bild (Seitenverhältnis bleibt, mittig im Feld)
      page.drawRectangle({ x, y: yTop - imgH, width: cellW, height: imgH, borderColor: LINE, borderWidth: 0.6, color: undefined });
      const bytes = await load(p, opts.quality);
      const img = bytes ? await embed(ctx, bytes) : null;
      if (img) {
        const k = Math.min((cellW - 4) / img.width, (imgH - 4) / img.height);
        const w = img.width * k;
        const h = img.height * k;
        page.drawImage(img, { x: x + (cellW - w) / 2, y: yTop - imgH + (imgH - h) / 2, width: w, height: h });
      } else {
        page.drawText('Bild nicht verfügbar', { x: x + 6, y: yTop - imgH / 2, size: 9, font: ctx.font, color: MUTED });
      }
      // Angaben darunter
      let ty = yTop - imgH - 12;
      const first = [opts.numbering ? `Nr. ${n}` : '', opts.showDate ? dateTimeLabel(p.takenAt) : '', opts.showUser && p.userName ? p.userName : ''].filter(Boolean).join(' · ');
      if (first) {
        page.drawText(fit(ctx.bold, clean(ctx, first), 8.5, cellW), { x, y: ty, size: 8.5, font: ctx.bold, color: INK });
        ty -= 11;
      }
      if (opts.showDescription) {
        for (const line of wrap(ctx, p.description || '–', 8.5, cellW, opts.perPage === 1 ? 3 : 2)) {
          page.drawText(line, { x, y: ty, size: 8.5, font: ctx.font, color: p.description ? INK : MUTED });
          ty -= 11;
        }
      }
      slot++;
    }
  }
  if (!ctx.doc.getPageCount()) {
    const page = ctx.doc.addPage(size);
    header(ctx, page, title, sub, opts.company, opts.logoRight);
    page.drawText('Keine Fotos.', { x: M, y: size[1] / 2, size: 11, font: ctx.font, color: MUTED });
  }
  footers(ctx, `Fotodokumentation ${[site.number, site.name].filter(Boolean).join(' ')}`);
  const stamp = new Date().toISOString().slice(0, 10);
  return { name: `${safeFileName('Fotos', site.name, stamp)}.pdf`, data: await ctx.doc.save(), mimeType: 'application/pdf' };
}

/** Bildauswahl je Qualität: hoch = Original (falls vorhanden), mittel = Ablagebild (≤ 2000 px), klein = verkleinert */
export const PDF_MAX_PX: Record<PhotoPdfQuality, number> = { klein: 1000, mittel: 2000, hoch: 10_000 };
