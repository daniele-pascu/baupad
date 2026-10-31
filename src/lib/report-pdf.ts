import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import type { CompanyLogo } from './company';
import { clean, FILL, footers, header, INK, LINE, M, MUTED, setup, type Ctx } from './crew-pdf';
import { DAY_NAMES, isoWeekNo, weekOf, WORKER_GRADES } from './crew';
import { A4L, A4P, brand, Form, type FormCol } from './form-pdf';
import { fmtDate, fmtHours, hasStaff, periodLabel, staffTotal, sumHours, typeInfo, workerHours } from './reports';
import type { DailyData, Report, ReportItem, WeeklyData } from './types';

/**
 * PDF der Berichte (pdf-lib, bereits im Projekt): A4 hoch, Kopf wie bei der Arbeitereinteilung (Logo bzw.
 * Firmenname links, Titel und Datum rechts). Ein kleiner Fließsatz bricht Texte und Tabellen sauber um,
 * wiederholt auf Folgeseiten Kopf und Tabellenüberschrift und gibt nur ausgefüllte Angaben aus.
 */

export interface ReportPdfOptions {
  company?: string;
  logo?: CompanyLogo | null;
  /** Firmenanschrift/Kontakt, mehrzeilig (Kopfblock der Formulare) */
  lines?: string;
}

const W = 595.28;
const H = 841.89;
const BOTTOM = 46;
const SIZE = 10;
const LH = 13.5;

interface Col {
  label: string;
  /** Anteil an der Breite */
  w: number;
  align?: 'left' | 'right' | 'center';
}

/** Fließsatz: schreibt von oben nach unten und beginnt bei Bedarf eine neue Seite */
class Flow {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly ctx: Ctx,
    readonly title: string,
    readonly sub: string,
    readonly company: string,
  ) {
    this.newPage(false);
  }

  newPage(cont = true) {
    this.page = this.ctx.doc.addPage([W, H]);
    this.y = header(this.ctx, this.page, cont ? `${this.title} (Fortsetzung)` : this.title, this.sub, this.company);
  }

  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  /** Text in Zeilen umbrechen (Wörter; zu lange Wörter werden geteilt) */
  wrap(text: string, font: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    // Zeilenumbrüche vor dem Bereinigen trennen (sie gehören nicht zum Zeichensatz der Schrift)
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of clean(this.ctx, para).split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= max) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        let w = word;
        while (font.widthOfTextAtSize(w, size) > max) {
          let i = w.length - 1;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > max) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }

  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    this.page.drawText(s, { x, y, size: opts.size ?? SIZE, font: opts.bold ? this.ctx.bold : this.ctx.font, color: opts.color ?? INK });
  }

  /** Abschnittsüberschrift mit feiner Linie */
  section(title: string) {
    this.ensure(44);
    this.y -= 10;
    this.text(clean(this.ctx, title.toUpperCase()), M, this.y - 10, { size: 8.5, bold: true, color: MUTED });
    this.y -= 15;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 8;
  }

  /** Angaben als Raster (Bezeichnung grau, Wert darunter) – nur ausgefüllte */
  info(pairs: [string, string][], columns = 3) {
    const list = pairs.filter(([, v]) => v.trim());
    if (!list.length) return;
    const colW = (W - 2 * M) / columns;
    for (let i = 0; i < list.length; i += columns) {
      const row = list.slice(i, i + columns);
      const lines = row.map(([, v]) => this.wrap(v, this.ctx.font, SIZE, colW - 12));
      const h = 12 + Math.max(...lines.map((l) => l.length)) * LH + 6;
      this.ensure(h);
      row.forEach(([label], k) => {
        const x = M + k * colW;
        this.text(clean(this.ctx, label), x, this.y - 9, { size: 8, color: MUTED });
        lines[k].forEach((t, j) => this.text(t, x, this.y - 22 - j * LH));
      });
      this.y -= h;
    }
  }

  /** Fließtext (mehrzeilig, über Seiten) */
  paragraph(s: string) {
    if (!s.trim()) return;
    for (const line of this.wrap(s, this.ctx.font, SIZE, W - 2 * M)) {
      this.ensure(LH);
      if (line) this.text(line, M, this.y - 10);
      this.y -= LH;
    }
    this.y -= 4;
  }

  /** Tabelle mit Umbruch je Zelle; Kopfzeile wiederholt sich auf Folgeseiten; optional Summenzeile */
  table(cols: Col[], rows: string[][], sum?: string[]) {
    if (!rows.length) return;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => ((W - 2 * M) * c.w) / total);
    const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((s, w) => s + w, 0));
    const pad = 5;
    const cell = (s: string, i: number, y: number, bold = false) => {
      const font = bold ? this.ctx.bold : this.ctx.font;
      const lines = this.wrap(s, font, SIZE, widths[i] - 2 * pad);
      lines.forEach((t, j) => {
        const w = font.widthOfTextAtSize(t, SIZE);
        const x = cols[i].align === 'right' ? xs[i] + widths[i] - pad - w : cols[i].align === 'center' ? xs[i] + (widths[i] - w) / 2 : xs[i] + pad;
        this.text(t, x, y - 11 - j * LH, { bold });
      });
    };
    const head = () => {
      this.ensure(22 + LH + 8);
      this.page.drawRectangle({ x: M, y: this.y - 18, width: W - 2 * M, height: 18, color: FILL });
      cols.forEach((c, i) => {
        const t = clean(this.ctx, c.label);
        const w = this.ctx.bold.widthOfTextAtSize(t, 8.5);
        const x = c.align === 'right' ? xs[i] + widths[i] - pad - w : c.align === 'center' ? xs[i] + (widths[i] - w) / 2 : xs[i] + pad;
        this.text(t, x, this.y - 12.5, { size: 8.5, bold: true, color: MUTED });
      });
      this.y -= 18;
    };
    head();
    const draw = (row: string[], bold: boolean) => {
      const h = Math.max(1, ...row.map((s, i) => this.wrap(s, bold ? this.ctx.bold : this.ctx.font, SIZE, widths[i] - 2 * pad).length)) * LH + 6;
      if (this.y - h < BOTTOM) {
        this.newPage();
        head();
      }
      row.forEach((s, i) => cell(s, i, this.y - 1, bold));
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: bold ? 0.9 : 0.4, color: bold ? INK : LINE });
    };
    rows.forEach((r) => draw(r, false));
    if (sum) draw(sum, true);
    this.y -= 6;
  }

  /** Unterschriftsfelder nebeneinander */
  signatures(labels: string[]) {
    this.ensure(78);
    this.y -= 34;
    const w = (W - 2 * M - (labels.length - 1) * 24) / labels.length;
    labels.forEach((l, i) => {
      const x = M + i * (w + 24);
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w, y: this.y }, thickness: 0.7, color: INK });
      this.text(clean(this.ctx, l), x, this.y - 12, { size: 8.5, color: MUTED });
    });
    this.y -= 24;
  }
}

/** Kopfdaten des Berichts (nur ausgefüllte) */
function headInfo(f: Flow, r: Report) {
  const h = r.head;
  f.info([
    ['Bauvorhaben', h.project],
    ['Baustelle', h.site !== h.project ? h.site : ''],
    ['Adresse', h.address],
    ['Auftraggeber', h.client],
    ['Projekt-Nr.', h.number],
    ['Kostenstelle', h.costCenter],
    ['Verantwortlich', h.responsible],
  ]);
}

const qty = (n: number | null) => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 3 }));
const qtyUnit = (x: ReportItem) => [qty(x.qty), x.unit].filter(Boolean).join(' ');
const filled = (list: ReportItem[]) => list.filter((x) => x.text.trim() || x.qty !== null);

/** Kopf der Formulare: Firmenblock; auf Folgeseiten dazu „… (Fortsetzung)“ */
function formHead(title: string, opts: ReportPdfOptions) {
  return (f: Form, cont: boolean) => {
    let y = brand(f, opts.company ?? '', opts.lines ?? '');
    if (cont) {
      f.text(`${title} (Fortsetzung)`, M, y - 4, { size: 10, bold: true });
      y -= 16;
    }
    return y;
  };
}

/**
 * Regieliste als Formular im A4-Querformat (wie die Regietagesliste): Kopfblock mit Auftraggeber, Bauvorhaben,
 * Auftrags-Nr., KW und Datum; Tätigkeiten; Personal-Tabelle mit Arbeitszeiten, Gesamtstunden und davon
 * NAZ / 50 % / 100 %; Gerät und Anmerkungen nebeneinander; Material; Unterschriften.
 */
function regieForm(ctx: Ctx, r: Report & { type: 'regie' }, opts: ReportPdfOptions) {
  const d = r.data;
  const h = r.head;
  const title = `Regieliste${r.no ? ` Nr. ${r.no}` : ''}`;
  const f = new Form(ctx, A4L, formHead(title, opts));
  const W = f.inner; // 777,89
  f.cells([
    { label: '', value: `REGIELISTE${r.no ? `   Nr. ${r.no}` : ''}`, w: W * 0.62, big: true },
    { label: 'Auftraggeber', value: h.client, w: W * 0.38 },
  ]);
  f.cells([
    { label: 'Bauvorhaben', value: [h.project, h.site && h.site !== h.project ? h.site : ''].filter(Boolean).join(' – '), w: W * 0.4 },
    { label: 'Auftrags-Nr. / Projekt-Nr.', value: h.number, w: W * 0.18 },
    { label: 'Kal.-Woche', value: `KW ${isoWeekNo(weekOf(r.date))}`, w: W * 0.12 },
    { label: 'Datum', value: fmtDate(r.date), w: W * 0.3 },
  ]);
  f.cells([
    { label: 'Baustellenadresse', value: h.address, w: W * 0.4 },
    { label: 'Kostenstelle', value: h.costCenter, w: W * 0.3 },
    { label: 'Verantwortlich', value: h.responsible, w: W * 0.3 },
  ]);
  f.linedBox(M, W, 'Tätigkeiten / ausgeführte Arbeiten', d.work, 3);
  f.y -= 8;
  const ws = d.workers.filter((w) => w.name.trim() || workerHours(w) !== null);
  const naz = (w: (typeof ws)[number]) => {
    const t = workerHours(w);
    if (t === null) return null;
    return Math.max(0, t - (w.ot50 ?? 0) - (w.ot100 ?? 0));
  };
  const cols: FormCol[] = [
    { label: 'PERSONAL', w: W * 0.26 },
    { label: 'Qualifikation', w: W * 0.14 },
    { label: 'von', w: W * 0.08, align: 'center' },
    { label: 'bis', w: W * 0.08, align: 'center' },
    { label: 'Pause', w: W * 0.08, align: 'center' },
    { label: 'Gesamt [Std]', w: W * 0.09, align: 'right' },
    { label: 'NAZ', w: W * 0.09, align: 'right' },
    { label: '50 %', w: W * 0.09, align: 'right' },
    { label: '100 %', w: W * 0.09, align: 'right' },
  ];
  const total = sumHours(ws);
  f.table(
    M,
    cols,
    ws.map((w) => [w.name, w.role, w.from, w.to, w.pause ? `${w.pause} min` : '', fmtHours(workerHours(w)), fmtHours(naz(w)), fmtHours(w.ot50 ?? null), fmtHours(w.ot100 ?? null)]),
    {
      minRows: 6,
      groups: [
        { label: '', span: 2 },
        { label: 'Arbeitszeiten', span: 3 },
        { label: '', span: 1 },
        { label: 'davon', span: 3 },
      ],
      sum: total === null ? undefined : ['Summe', '', '', '', '', fmtHours(total), fmtHours(ws.reduce((s, w) => s + (naz(w) ?? 0), 0)), fmtHours(ws.reduce((s, w) => s + (w.ot50 ?? 0), 0) || null), fmtHours(ws.reduce((s, w) => s + (w.ot100 ?? 0), 0) || null)],
    },
  );
  f.y -= 10;
  // Gerät (links) und Anmerkungen (rechts) nebeneinander, wenn beides auf die Seite passt
  const eq = filled(d.equipment).map((x) => [x.text, qty(x.qty), x.unit]);
  const leftW = W * 0.52;
  const gap = 12;
  const eqCols: FormCol[] = [
    { label: 'GERÄT', w: leftW * 0.66 },
    { label: 'Menge', w: leftW * 0.18, align: 'right' },
    { label: 'EH', w: leftW * 0.16 },
  ];
  const eqRows = Math.max(4, eq.length);
  const eqH = 14 + eqRows * 15 + 2;
  const noteLines = Math.max(5, f.wrap(d.notes, ctx.font, 9.2, W - leftW - gap - 10).length);
  const blockH = Math.max(eqH, 13 + noteLines * 12.5);
  if (blockH <= f.free - 20) {
    f.ensure(blockH);
    const top = f.y;
    f.table(M, eqCols, eq, { minRows: eqRows });
    const afterEq = f.y;
    f.y = top;
    f.linedBox(M + leftW + gap, W - leftW - gap, 'Anmerkungen', d.notes, Math.max(5, Math.round((eqH - 13) / 12.5)));
    f.y = Math.min(afterEq, f.y);
  } else {
    f.table(M, eqCols, eq, { minRows: eqRows });
    f.y -= 10;
    f.linedBox(M, W, 'Anmerkungen', d.notes, 5);
  }
  f.y -= 10;
  const mat = filled(d.materials).map((x) => [x.text, qty(x.qty), x.unit]);
  f.table(
    M,
    [
      { label: 'MATERIAL', w: leftW * 0.66 },
      { label: 'Menge', w: leftW * 0.18, align: 'right' },
      { label: 'EH', w: leftW * 0.16 },
    ],
    mat,
    { minRows: 4 },
  );
  // Unterschriften rechts neben dem Material, sonst darunter
  const sigW = W - leftW - gap;
  const sx = M + leftW + gap;
  const sy = f.y + 24;
  f.line(sx, sy, sx + sigW / 2 - 10, sy, 0.5, MUTED);
  f.text('Auftraggeber / Kontrolle', sx, sy - 9, { size: 7, color: MUTED });
  f.line(sx + sigW / 2 + 10, sy, sx + sigW, sy, 0.5, MUTED);
  f.text(opts.company || 'Auftragnehmer', sx + sigW / 2 + 10, sy - 9, { size: 7, color: MUTED });
  return f;
}

/**
 * Bautagesbericht als Formular im A4-Hochformat: Kopfblock (Titel, Datum, Nr., Bauvorhaben, Auftraggeber,
 * Arbeitszeit, Wetter, Personalstand), dreiteilige Tabelle Personaleinsatz / Geräte / Material mit „Ist“,
 * Leistungsfortschritt, besondere Vorkommnisse, Bemerkungen, Unterschriftsfelder AN / ÖBA.
 */
/** „BL 1 · VA 1 · FA 3 · HA 2“ – nur, wenn ein Personalstand eingetragen ist */
function staffText(d: DailyData): string {
  if (!hasStaff(d.staff)) return '';
  const parts = WORKER_GRADES.filter((g) => (d.staff?.[g.id] ?? 0) > 0).map((g) => `${g.short} ${d.staff![g.id]}`);
  return parts.length ? `${staffTotal(d.staff)} (${parts.join(' · ')})` : '';
}

function dailyForm(ctx: Ctx, r: Report & { type: 'tag' }, opts: ReportPdfOptions) {
  const d = r.data;
  const h = r.head;
  const title = `Bautagesbericht${r.no ? ` Nr. ${r.no}` : ''}`;
  const f = new Form(ctx, A4P, formHead(title, opts));
  const W = f.inner; // 531,28
  const present = d.crew.filter((w) => w.present !== false && w.name.trim());
  const count = d.crewCount ?? (present.length || null);
  f.cells([
    { label: 'Auftragnehmer', value: opts.company ?? '', w: W * 0.28 },
    { label: '', value: 'BAUTAGESBERICHT', w: W * 0.44, big: true, align: 'center' },
    { label: 'Datum', value: fmtDate(r.date, false), w: W * 0.16 },
    { label: 'Nr.', value: r.no, w: W * 0.12 },
  ]);
  f.cells([
    { label: 'Bauvorhaben', value: [h.project, h.site && h.site !== h.project ? h.site : ''].filter(Boolean).join(' – '), w: W * 0.44 },
    { label: 'Baustellenadresse', value: h.address, w: W * 0.28 },
    { label: 'Auftraggeber', value: h.client, w: W * 0.28 },
  ]);
  const weather = [d.weather, d.tempMin || d.tempMax ? `Temperatur ${[d.tempMin && `min. ${d.tempMin} °C`, d.tempMax && `max. ${d.tempMax} °C`].filter(Boolean).join(', ')}` : ''].filter(Boolean).join('\n');
  f.cells([
    { label: 'Arbeitszeit', value: d.from || d.to ? `von ${d.from || '__:__'} bis ${d.to || '__:__'} Uhr` : '', w: W * 0.28 },
    { label: 'Wetter', value: weather, w: W * 0.44 },
    { label: 'Personalstand', value: staffText(d) || (count !== null ? `${count} ${count === 1 ? 'Person' : 'Personen'}` : ''), w: W * 0.28 },
  ]);
  f.cells([
    { label: 'Projekt-Nr.', value: h.number, w: W * 0.28 },
    { label: 'Kostenstelle', value: h.costCenter, w: W * 0.44 },
    { label: 'Verantwortlich', value: h.responsible, w: W * 0.28 },
  ]);
  f.y -= 8;
  const eq = filled(d.equipment);
  const mat = filled(d.materials);
  const n = Math.max(8, present.length, eq.length, mat.length);
  const third = W / 3;
  const cols: FormCol[] = [
    { label: 'PERSONALEINSATZ', w: third - 38 },
    { label: 'Std', w: 38, align: 'right' },
    { label: 'GERÄTE', w: third - 44 },
    { label: 'Ist', w: 44, align: 'right' },
    { label: 'MATERIAL', w: third - 44 },
    { label: 'Ist', w: 44, align: 'right' },
  ];
  const rows = Array.from({ length: n }, (_, i) => {
    const w = present[i];
    return [w ? [w.name, w.role].filter(Boolean).join(' · ') : '', w ? fmtHours(workerHours(w)) : '', eq[i]?.text ?? '', eq[i] ? qtyUnit(eq[i]) : '', mat[i]?.text ?? '', mat[i] ? qtyUnit(mat[i]) : ''];
  });
  const hours = sumHours(present);
  f.table(M, cols, rows, { sum: hours !== null ? ['Summe', fmtHours(hours), '', '', '', ''] : undefined });
  f.y -= 8;
  f.linedBox(M, W, 'LEISTUNGSFORTSCHRITT / durchgeführte Arbeiten', d.work, 10);
  f.y -= 8;
  f.linedBox(M, W, 'BESONDERE VORKOMMNISSE / Behinderungen', d.incidents, 3);
  f.y -= 8;
  f.linedBox(M, W, 'BEMERKUNGEN', d.notes, 2);
  if (d.acceptanceTime || d.acceptanceBy) {
    f.y -= 8;
    f.cells([{ label: 'Schlussabnahme', value: [d.acceptanceTime && `${d.acceptanceTime} Uhr`, d.acceptanceBy && `von ${d.acceptanceBy}`].filter(Boolean).join(', '), w: W }]);
  }
  f.signatureBoxes([`für den AN${opts.company ? ` – ${opts.company}` : ''}`, 'für den AG / die ÖBA']);
  return f;
}

function weekly(f: Flow, d: WeeklyData) {
  const days = d.days.filter((x) => x.work.trim() || x.names.trim() || x.count !== null);
  if (days.length) {
    f.section('Wochenübersicht');
    f.table(
      [
        { label: 'Tag', w: 1.7 },
        { label: 'Mannschaft', w: 2.3 },
        { label: 'Durchgeführte Arbeiten', w: 6 },
      ],
      days.map((x) => {
        const day = DAY_NAMES[(new Date(`${x.date}T12:00:00`).getDay() + 6) % 7];
        const crew = [x.count !== null ? `${x.count} ${x.count === 1 ? 'Person' : 'Personen'}` : '', x.names].filter(Boolean).join('\n');
        return [`${day}\n${fmtDate(x.date, false)}`, crew, x.work];
      }),
    );
  }
  if (d.events.trim()) {
    f.section('Wichtige Ereignisse / Behinderungen');
    f.paragraph(d.events);
  }
  if (d.notes.trim()) {
    f.section('Bemerkungen');
    f.paragraph(d.notes);
  }
  if (d.open.trim()) {
    f.section('Offene Punkte');
    f.paragraph(d.open);
  }
  f.signatures(['Auftragnehmer – Datum, Unterschrift', 'Auftraggeber / Kontrolle – Datum, Unterschrift']);
}

/** PDF eines Berichts (Layout je Typ) */
export async function reportPdf(r: Report, opts: ReportPdfOptions = {}): Promise<ExportFile> {
  const ctx = await setup(opts);
  const info = typeInfo(r.type);
  const title = `${info.label}${r.no ? ` Nr. ${r.no}` : ''}`;
  if (r.type === 'regie') regieForm(ctx, r, opts);
  else if (r.type === 'tag') dailyForm(ctx, r, opts);
  else {
    const f = new Flow(ctx, title, periodLabel(r), opts.company ?? '');
    headInfo(f, r);
    weekly(f, r.data);
  }
  footers(ctx, [info.label, r.head.site || r.head.project].filter(Boolean).join(' · '));
  return {
    name: `${safeFileName(info.label, r.head.site || r.head.project, r.no ? `Nr${r.no}` : '', r.date)}.pdf`,
    data: await ctx.doc.save(),
    mimeType: 'application/pdf',
  };
}
