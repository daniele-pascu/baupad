import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import type { CompanyLogo } from './company';
import { DAY_NAMES, DAY_SHORT, dayDate, dayList, isoWeekNo, parseDate, addDays, sortWorkers, timeLabel, unassigned, visibleDays, weekRange, workerName } from './crew';
import type { WeekPlan, WeekSite, Worker, WorkTimes } from './types';

/**
 * PDF der Arbeitereinteilung (pdf-lib, bereits im Projekt): Wochenplan im A4-Querformat mit derselben
 * Gliederung wie am Bildschirm (Baustelle → Tage → Arbeiter) und Tagesliste einer Baustelle (A4 hoch).
 * Viele Baustellen → mehrere Seiten statt kleiner Schrift.
 */

export interface CrewPdfOptions {
  company?: string;
  logo?: CompanyLogo | null;
  /** Urlaub/Krank (von–bis) an diesem Tag – wird beim Namen gekennzeichnet */
  absent?: (workerId: string, day: number) => 'urlaub' | 'krank' | null;
  /** Uhrzeiten anzeigen (Standard: ja) */
  showTimes?: boolean;
}

/** Kennzeichnung beim Namen: „ (Urlaub)“ bzw. „ (krank)“ */
const mark = (opts: CrewPdfOptions, id: string, day: number) => ({ urlaub: ' (Urlaub)', krank: ' (krank)', none: '' })[opts.absent?.(id, day) ?? 'none'];

export const INK = rgb(0.11, 0.11, 0.12);
export const MUTED = rgb(0.43, 0.43, 0.45);
export const LINE = rgb(0.82, 0.82, 0.85);
export const FILL = rgb(0.95, 0.95, 0.97);
const ACCENT = rgb(0.18, 0.5, 0.93);
export const M = 32;

export interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  charset: Set<number>;
  logo: PDFImage | null;
}

/** Text für die Standardschrift: Zeichen außerhalb (z. B. ł, ć, č) ohne Akzent bzw. „?“ */
export function clean(ctx: Ctx, s: string): string {
  const map: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ø: 'o', Ø: 'O', '—': '-', '→': '>' };
  return [...s]
    .map((ch) => {
      if (ctx.charset.has(ch.codePointAt(0)!)) return ch;
      if (map[ch]) return map[ch];
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return [...base].every((c) => ctx.charset.has(c.codePointAt(0)!)) ? base : '?';
    })
    .join('');
}

export function fit(font: PDFFont, text: string, size: number, max: number): string {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function setup(opts: Pick<CrewPdfOptions, 'logo'>): Promise<Ctx> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  try {
    if (opts.logo) logo = opts.logo.type === 'png' ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
  } catch {
    logo = null; // Logo ist optional
  }
  return { doc, font, bold, charset: new Set(font.getCharacterSet()), logo };
}

/** Kopf: links Firmenlogo (ohne Logo der Firmenname in Buchstaben), rechts Titel mit Zeitraum; liefert die y-Position darunter */
export function header(ctx: Ctx, page: PDFPage, title: string, sub: string, company: string): number {
  const { width, height } = page.getSize();
  let y = height - M;
  let left = M;
  if (ctx.logo) {
    const h = 32;
    const w = Math.min(140, (ctx.logo.width / ctx.logo.height) * h);
    const lh = (w / ctx.logo.width) * ctx.logo.height;
    page.drawImage(ctx.logo, { x: M, y: y - 1 - (h + lh) / 2, width: w, height: lh });
    left += w + 20;
  } else if (company) {
    const c = fit(ctx.bold, clean(ctx, company), 15, width / 2 - M);
    page.drawText(c, { x: M, y: y - 22, size: 15, font: ctx.bold, color: INK });
    left += ctx.bold.widthOfTextAtSize(c, 15) + 20;
  }
  // rechts: Titel und Zeitraum, rechtsbündig
  const right = (text: string, size: number, font: PDFFont, color: typeof INK, ty: number) => {
    const t = fit(font, clean(ctx, text), size, width - M - left);
    page.drawText(t, { x: width - M - font.widthOfTextAtSize(t, size), y: ty, size, font, color });
  };
  right(title, 16, ctx.bold, INK, y - 16);
  right(sub, 10, ctx.font, MUTED, y - 30);
  y -= 40;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1.2, color: INK });
  return y - 12;
}

export function footers(ctx: Ctx, left: string) {
  const pages = ctx.doc.getPages();
  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    p.drawText(clean(ctx, `${left} · erstellt am ${today}`), { x: M, y: 18, size: 8, font: ctx.font, color: MUTED });
    const t = `Seite ${i + 1} von ${pages.length}`;
    p.drawText(t, { x: width - M - ctx.font.widthOfTextAtSize(t, 8), y: 18, size: 8, font: ctx.font, color: MUTED });
  });
}

const NAME = 9.5;
const LH = 13;

/** Wochenplan im A4-Querformat: je Baustelle ein Abschnitt mit den Tagen als Spalten */
export async function crewWeekPdf(plan: WeekPlan, workers: Worker[], times: WorkTimes, opts: CrewPdfOptions = {}): Promise<ExportFile> {
  const ctx = await setup(opts);
  const W = 841.89;
  const H = 595.28;
  const byId = new Map(workers.map((w) => [w.id, w]));
  const nameOf = (id: string) => (byId.get(id) ? workerName(byId.get(id)!) : 'Unbekannt');
  const days = visibleDays();
  const kw = isoWeekNo(plan.id);
  const title = `Arbeitereinteilung KW ${kw}`;
  const sub = `${weekRange(plan.id, days[days.length - 1])}`;
  const colW = (W - 2 * M) / days.length;

  let page = ctx.doc.addPage([W, H]);
  let y = header(ctx, page, title, sub, opts.company ?? '');
  const newPage = () => {
    page = ctx.doc.addPage([W, H]);
    y = header(ctx, page, `${title} (Fortsetzung)`, sub, opts.company ?? '');
  };

  const siteHeight = (s: WeekSite) => {
    const rows = Math.max(1, ...days.map((d) => s.days[d].length));
    return 22 + 26 + rows * LH + 10 + (s.note ? 18 : 16);
  };

  for (const s of plan.sites.filter((x) => !x.paused)) {
    const h = siteHeight(s);
    if (y - h < M + 20 && y < H - M - 60) newPage();
    // Kopf der Baustelle
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: FILL });
    page.drawRectangle({ x: M, y: y - 22, width: 3, height: 22, color: s.finished ? rgb(0.12, 0.62, 0.33) : ACCENT });
    const name = fit(ctx.bold, clean(ctx, s.name), 12, 420);
    page.drawText(name, { x: M + 10, y: y - 15.5, size: 12, font: ctx.bold, color: INK });
    const meta = [s.number, s.address, s.finished ? 'abgeschlossen' : ''].filter(Boolean).join(' · ');
    if (meta) page.drawText(fit(ctx.font, clean(ctx, meta), 9, W - 2 * M - 30 - ctx.bold.widthOfTextAtSize(name, 12)), { x: M + 22 + ctx.bold.widthOfTextAtSize(name, 12), y: y - 15, size: 9, font: ctx.font, color: MUTED });
    y -= 22;
    // Tage
    days.forEach((d, i) => {
      const x = M + i * colW;
      page.drawText(`${DAY_SHORT[d]} ${dayDate(plan.id, d)}`, { x: x + 6, y: y - 12, size: 9, font: ctx.bold, color: INK });
      const t = opts.showTimes === false ? '' : timeLabel(times[d]);
      if (t) page.drawText(t, { x: x + 6, y: y - 22, size: 7.5, font: ctx.font, color: MUTED });
    });
    y -= 26;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    const rows = Math.max(1, ...days.map((d) => s.days[d].length));
    days.forEach((d, i) => {
      const x = M + i * colW;
      s.days[d].forEach((id, r) => {
        page.drawText(fit(ctx.font, clean(ctx, nameOf(id) + mark(opts, id, d)), NAME, colW - 12), { x: x + 6, y: y - 11 - r * LH, size: NAME, font: ctx.font, color: INK });
      });
      if (i > 0) page.drawLine({ start: { x, y: y + 26 }, end: { x, y: y - rows * LH - 6 }, thickness: 0.5, color: LINE });
    });
    y -= rows * LH + 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    // Bemerkung (oder Platz für Notizen)
    page.drawText('Bemerkung:', { x: M + 6, y: y - 12, size: 8.5, font: ctx.bold, color: MUTED });
    if (s.note) page.drawText(fit(ctx.font, clean(ctx, s.note), 9, W - 2 * M - 70), { x: M + 60, y: y - 12, size: 9, font: ctx.font, color: INK });
    else page.drawLine({ start: { x: M + 60, y: y - 13 }, end: { x: W - M - 6, y: y - 13 }, thickness: 0.4, color: LINE, dashArray: [2, 2] });
    y -= (s.note ? 18 : 16) + 12;
  }

  // Urlaub und noch nicht eingeteilt (sollte leer sein)
  const open = days
    .filter((d) => d < 5) // Sa/So: nur wer dort eingeteilt ist
    .map((d) => ({ d, list: unassigned(plan, sortWorkers(workers), d).filter((w) => !opts.absent?.(w.id, d)) }))
    .filter((x) => x.list.length);
  const lines: { label: string; text: string }[] = [];
  // Urlaub aus der Woche und aus den Zeiträumen (von–bis), krank nur aus den Zeiträumen
  const away = (kind: 'urlaub' | 'krank') =>
    sortWorkers(workers)
      .map((w) => ({ w, ds: days.filter((d) => (kind === 'urlaub' && plan.vacation[d]?.includes(w.id)) || opts.absent?.(w.id, d) === kind) }))
      .filter((x) => x.ds.length)
      .map((x) => `${workerName(x.w)} (${dayList(x.ds)})`)
      .join(', ');
  if (away('urlaub')) lines.push({ label: 'Urlaub:', text: away('urlaub') });
  if (away('krank')) lines.push({ label: 'Krank:', text: away('krank') });
  for (const o of open) lines.push({ label: `Nicht eingeteilt ${DAY_SHORT[o.d]}:`, text: o.list.map(workerName).join(', ') });
  if (!plan.sites.length) lines.unshift({ label: 'Hinweis:', text: 'Keine Baustelle in dieser Woche.' });
  for (const l of lines) {
    if (y < M + 30) newPage();
    page.drawText(clean(ctx, l.label), { x: M, y: y - 10, size: 9, font: ctx.bold, color: INK });
    const lx = M + ctx.bold.widthOfTextAtSize(clean(ctx, l.label), 9) + 6;
    page.drawText(fit(ctx.font, clean(ctx, l.text), 9, W - M - lx), { x: lx, y: y - 10, size: 9, font: ctx.font, color: INK });
    y -= 16;
  }
  footers(ctx, `${title} · ${sub}`);
  return {
    name: `${safeFileName('Arbeitereinteilung', `KW${String(kw).padStart(2, '0')}`, String(parseDate(plan.id).getFullYear()))}.pdf`,
    data: await ctx.doc.save(),
    mimeType: 'application/pdf',
  };
}

/** Tagesliste einer Baustelle (A4 hoch): Arbeiter mit Tätigkeit und Telefon, Spalte für Bemerkung/Unterschrift */
export async function crewDayPdf(plan: WeekPlan, siteId: string, day: number, workers: Worker[], times: WorkTimes, opts: CrewPdfOptions = {}): Promise<ExportFile> {
  const ctx = await setup(opts);
  const W = 595.28;
  const H = 841.89;
  const s = plan.sites.find((x) => x.id === siteId)!;
  const byId = new Map(workers.map((w) => [w.id, w]));
  const date = parseDate(addDays(plan.id, day)).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const title = `Tagesliste ${DAY_NAMES[day]}, ${date}`;
  let page = ctx.doc.addPage([W, H]);
  let y = header(ctx, page, title, `KW ${isoWeekNo(plan.id)}`, opts.company ?? '');
  // Baustelle
  page.drawText(fit(ctx.bold, clean(ctx, s.name), 14, W - 2 * M), { x: M, y: y - 14, size: 14, font: ctx.bold, color: INK });
  y -= 20;
  const meta = [s.number, s.address].filter(Boolean).join(' · ');
  if (meta) {
    page.drawText(fit(ctx.font, clean(ctx, meta), 10, W - 2 * M), { x: M, y: y - 10, size: 10, font: ctx.font, color: MUTED });
    y -= 16;
  }
  const t = opts.showTimes === false ? '' : timeLabel(times[day]);
  if (t) {
    page.drawText(`Arbeitszeit: ${t} Uhr`, { x: M, y: y - 10, size: 10, font: ctx.font, color: INK });
    y -= 16;
  }
  if (s.note) {
    page.drawText(fit(ctx.font, clean(ctx, `Bemerkung: ${s.note}`), 10, W - 2 * M), { x: M, y: y - 10, size: 10, font: ctx.font, color: INK });
    y -= 16;
  }
  y -= 10;
  // Tabelle
  const cols = [
    { h: 'Nr.', w: 30 },
    { h: 'Name', w: 170 },
    { h: 'Tätigkeit', w: 110 },
    { h: 'Telefon', w: 100 },
    { h: 'Bemerkung / Unterschrift', w: W - 2 * M - 410 },
  ];
  const row = 24;
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - row, width: W - 2 * M, height: row, color: FILL });
    let x = M;
    for (const c of cols) {
      page.drawText(clean(ctx, c.h), { x: x + 6, y: y - 15.5, size: 9, font: ctx.bold, color: INK });
      x += c.w;
    }
    y -= row;
  };
  drawHead();
  const ids = s.days[day];
  const list = ids.map((id) => byId.get(id)).filter(Boolean) as Worker[];
  // drei leere Zeilen für Ergänzungen von Hand
  const rows: (Worker | null)[] = [...sortWorkers(list), null, null, null];
  rows.forEach((w, i) => {
    if (y - row < M + 20) {
      page = ctx.doc.addPage([W, H]);
      y = header(ctx, page, `${title} (Fortsetzung)`, s.name, opts.company ?? '');
      drawHead();
    }
    const cells = w ? [String(i + 1), workerName(w) + mark(opts, w.id, day), w.role ?? '', w.phone ?? '', ''] : ['', '', '', '', ''];
    let x = M;
    cells.forEach((c, k) => {
      if (c) page.drawText(fit(ctx.font, clean(ctx, c), 10, cols[k].w - 10), { x: x + 6, y: y - 15.5, size: 10, font: ctx.font, color: INK });
      x += cols[k].w;
    });
    y -= row;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
  });
  page.drawText(`${list.length} Arbeiter eingeteilt`, { x: M, y: y - 16, size: 9, font: ctx.font, color: MUTED });
  footers(ctx, `${s.name} · ${title}`);
  return {
    name: `${safeFileName('Tagesliste', s.name, addDays(plan.id, day))}.pdf`,
    data: await ctx.doc.save(),
    mimeType: 'application/pdf',
  };
}
