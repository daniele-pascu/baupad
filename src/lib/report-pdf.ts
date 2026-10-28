import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import type { CompanyLogo } from './company';
import { clean, FILL, footers, header, INK, LINE, M, MUTED, setup, type Ctx } from './crew-pdf';
import { DAY_NAMES } from './crew';
import { fmtDate, fmtHours, periodLabel, sumHours, typeInfo, workerHours } from './reports';
import type { DailyData, RegieData, Report, ReportItem, WeeklyData } from './types';

/**
 * PDF der Berichte (pdf-lib, bereits im Projekt): A4 hoch, Kopf wie bei der Arbeitereinteilung (Logo bzw.
 * Firmenname links, Titel und Datum rechts). Ein kleiner Fließsatz bricht Texte und Tabellen sauber um,
 * wiederholt auf Folgeseiten Kopf und Tabellenüberschrift und gibt nur ausgefüllte Angaben aus.
 */

export interface ReportPdfOptions {
  company?: string;
  logo?: CompanyLogo | null;
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
const items = (f: Flow, title: string, list: ReportItem[]) => {
  const rows = list.filter((x) => x.text.trim() || x.qty !== null).map((x) => [qty(x.qty), x.unit, x.text]);
  if (!rows.length) return;
  f.section(title);
  f.table(
    [
      { label: 'Menge', w: 1.1, align: 'right' },
      { label: 'Einheit', w: 1 },
      { label: 'Bezeichnung', w: 6 },
    ],
    rows,
  );
};

function regie(f: Flow, d: RegieData) {
  const ws = d.workers.filter((w) => w.name.trim() || workerHours(w) !== null);
  if (ws.length) {
    f.section('Personal');
    const ot = d.overtime && ws.some((w) => w.ot50 || w.ot100);
    const times = ws.some((w) => w.from || w.to);
    const cols: Col[] = [
      { label: 'Name', w: 3.2 },
      { label: 'Qualifikation', w: 2.2 },
      ...(times
        ? [
            { label: 'von', w: 1, align: 'center' as const },
            { label: 'bis', w: 1, align: 'center' as const },
            { label: 'Pause', w: 1, align: 'center' as const },
          ]
        : []),
      { label: 'Std.', w: 1, align: 'right' },
      ...(ot
        ? [
            { label: '50 %', w: 0.9, align: 'right' as const },
            { label: '100 %', w: 0.9, align: 'right' as const },
          ]
        : []),
    ];
    const rows = ws.map((w) => [
      w.name,
      w.role,
      ...(times ? [w.from, w.to, w.pause ? `${w.pause} min` : ''] : []),
      fmtHours(workerHours(w)),
      ...(ot ? [fmtHours(w.ot50 ?? null), fmtHours(w.ot100 ?? null)] : []),
    ]);
    const total = sumHours(ws);
    const sum = total === null ? undefined : ['Summe', '', ...(times ? ['', '', ''] : []), fmtHours(total), ...(ot ? ['', ''] : [])];
    f.table(cols, rows, sum);
  }
  if (d.work.trim()) {
    f.section('Tätigkeiten / ausgeführte Arbeiten');
    f.paragraph(d.work);
  }
  items(f, 'Material', d.materials);
  items(f, 'Geräte', d.equipment);
  if (d.notes.trim()) {
    f.section('Bemerkungen');
    f.paragraph(d.notes);
  }
  f.signatures(['Auftragnehmer – Datum, Unterschrift', 'Auftraggeber / Kontrolle – Datum, Unterschrift']);
}

function daily(f: Flow, d: DailyData) {
  const present = d.crew.filter((w) => w.present !== false && w.name.trim());
  const count = d.crewCount ?? (present.length || null);
  f.info(
    [
      ['Arbeitszeit', d.from || d.to ? `${d.from || '?'} – ${d.to || '?'} Uhr` : ''],
      ['Wetter', d.weather],
      ['Temperatur', d.tempMin || d.tempMax ? [d.tempMin && `min. ${d.tempMin} °C`, d.tempMax && `max. ${d.tempMax} °C`].filter(Boolean).join(' / ') : ''],
      ['Mannschaft', count !== null ? `${count} ${count === 1 ? 'Person' : 'Personen'}` : ''],
    ],
    4,
  );
  if (present.length) {
    f.section('Anwesend');
    const withHours = present.some((w) => workerHours(w) !== null);
    f.table(
      [
        { label: 'Name', w: 3.4 },
        { label: 'Qualifikation', w: 2.6 },
        ...(withHours ? [{ label: 'Std.', w: 1, align: 'right' as const }] : []),
      ],
      present.map((w) => [w.name, w.role, ...(withHours ? [fmtHours(workerHours(w))] : [])]),
      withHours && sumHours(present) !== null ? ['Summe', '', fmtHours(sumHours(present))] : undefined,
    );
  }
  if (d.work.trim()) {
    f.section('Durchgeführte Arbeiten');
    f.paragraph(d.work);
  }
  items(f, 'Material', d.materials);
  items(f, 'Geräte', d.equipment);
  if (d.incidents.trim()) {
    f.section('Besondere Vorkommnisse / Behinderungen');
    f.paragraph(d.incidents);
  }
  if (d.notes.trim()) {
    f.section('Bemerkungen');
    f.paragraph(d.notes);
  }
  f.signatures(['Auftragnehmer – Datum, Unterschrift', 'Auftraggeber / ÖBA – Datum, Unterschrift']);
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
  const f = new Flow(ctx, title, periodLabel(r), opts.company ?? '');
  headInfo(f, r);
  if (r.type === 'regie') regie(f, r.data);
  else if (r.type === 'tag') daily(f, r.data);
  else weekly(f, r.data);
  footers(ctx, [info.label, r.head.site || r.head.project].filter(Boolean).join(' · '));
  return {
    name: `${safeFileName(info.label, r.head.site || r.head.project, r.no ? `Nr${r.no}` : '', r.date)}.pdf`,
    data: await ctx.doc.save(),
    mimeType: 'application/pdf',
  };
}
