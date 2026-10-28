import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { clean, FILL, INK, LINE, M, MUTED, type Ctx } from './crew-pdf';

/**
 * Formular-PDF (pdf-lib): gerahmte Felder mit kleiner Beschriftung, Tabellen mit Mindestzeilen und linierte
 * Textfelder – so wie die klassischen Baustellenformulare (Regieliste, Bautagesbericht). Wird eine Seite voll,
 * geht es auf der nächsten weiter (Tabellenkopf wiederholt sich, Textfelder laufen weiter).
 */

export const A4P: [number, number] = [595.28, 841.89];
export const A4L: [number, number] = [841.89, 595.28];
const BOTTOM = 40;
export const LH = 12.5;
const LABEL = 6.8;
const TEXT = 9.2;
const GRAY = rgb(0.3, 0.3, 0.32);

export interface FormCol {
  label: string;
  /** Breite in Punkt */
  w: number;
  align?: 'left' | 'right' | 'center';
}
export interface FormCell {
  label: string;
  value: string;
  w: number;
  /** Wert größer/fett (z. B. Titel) */
  big?: boolean;
  align?: 'left' | 'center' | 'right';
}

export class Form {
  page!: PDFPage;
  y = 0;
  readonly W: number;
  readonly H: number;
  constructor(
    readonly ctx: Ctx,
    size: [number, number],
    /** zeichnet den Seitenkopf (Firma, Titel) und liefert die y-Position darunter */
    private readonly head: (f: Form, cont: boolean) => number,
  ) {
    this.W = size[0];
    this.H = size[1];
    this.newPage(false);
  }
  get inner() {
    return this.W - 2 * M;
  }
  newPage(cont = true) {
    this.page = this.ctx.doc.addPage([this.W, this.H]);
    this.y = this.head(this, cont);
  }
  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }
  get free() {
    return this.y - BOTTOM;
  }

  wrap(text: string, font: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
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
  text(s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'center' | 'right'; w?: number } = {}) {
    const font = o.bold ? this.ctx.bold : this.ctx.font;
    const size = o.size ?? TEXT;
    const t = clean(this.ctx, s);
    const tw = font.widthOfTextAtSize(t, size);
    const px = o.align === 'right' ? x + (o.w ?? 0) - tw : o.align === 'center' ? x + ((o.w ?? 0) - tw) / 2 : x;
    this.page.drawText(t, { x: px, y, size, font, color: o.color ?? INK });
  }
  rect(x: number, y: number, w: number, h: number, o: { fill?: boolean; thick?: number } = {}) {
    this.page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: o.thick ?? 0.6, color: o.fill ? FILL : undefined });
  }
  line(x1: number, y1: number, x2: number, y2: number, thick = 0.5, color = INK) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: thick, color });
  }

  /** eine Zeile gerahmter Felder (Beschriftung klein oben links, Wert darunter); Höhe wächst mit dem Inhalt */
  cells(cells: FormCell[], minH = 26): number {
    const lines = cells.map((c) => (c.value ? this.wrap(c.value, c.big ? this.ctx.bold : this.ctx.font, c.big ? 15 : TEXT, c.w - 8) : []));
    const h = Math.max(minH, ...lines.map((l, i) => (cells[i].label ? 11 : 4) + l.length * (cells[i].big ? 18 : LH) + 4));
    this.ensure(h);
    let x = M;
    cells.forEach((c, i) => {
      this.rect(x, this.y - h, c.w, h);
      if (c.label) this.text(c.label, x + 3, this.y - 8, { size: LABEL, color: GRAY });
      lines[i].forEach((t, j) => this.text(t, x + 4, this.y - (c.label ? 11 : 4) - (c.big ? 15 : TEXT) - j * (c.big ? 18 : LH) + 1, { size: c.big ? 15 : TEXT, bold: c.big, align: c.align, w: c.w - 8 }));
      x += c.w;
    });
    this.y -= h;
    return h;
  }

  /**
   * Tabelle mit Rahmen und grauem Kopf; mindestens `minRows` Zeilen (leere werden als Linien gezeichnet);
   * optionale Gruppenzeile über den Spalten; Summenzeile fett. Bricht über Seiten um.
   */
  table(x: number, cols: FormCol[], rows: string[][], o: { minRows?: number; groups?: { label: string; span: number }[]; sum?: string[]; rowH?: number; title?: string } = {}) {
    const rowH = o.rowH ?? 15;
    const width = cols.reduce((s, c) => s + c.w, 0);
    const xs = cols.map((_, i) => x + cols.slice(0, i).reduce((s, c) => s + c.w, 0));
    const headH = (o.groups ? 12 : 0) + 14;
    const head = () => {
      this.ensure(headH + rowH * 2);
      let y = this.y;
      if (o.groups) {
        let gx = x;
        let ci = 0;
        for (const g of o.groups) {
          const gw = cols.slice(ci, ci + g.span).reduce((s, c) => s + c.w, 0);
          this.rect(gx, y - 12, gw, 12, { fill: true });
          if (g.label) this.text(g.label, gx, y - 9, { size: 7, bold: true, align: 'center', w: gw, color: GRAY });
          gx += gw;
          ci += g.span;
        }
        y -= 12;
      }
      cols.forEach((c, i) => {
        this.rect(xs[i], y - 14, c.w, 14, { fill: true });
        this.text(c.label, xs[i] + 3, y - 10, { size: 7.2, bold: true, align: c.align, w: c.w - 6, color: GRAY });
      });
      this.y = y - 14;
    };
    const row = (cells: string[], bold = false) => {
      const font = bold ? this.ctx.bold : this.ctx.font;
      const ls = cells.map((s, i) => this.wrap(s, font, TEXT - 0.4, cols[i].w - 6));
      const h = Math.max(rowH, Math.max(1, ...ls.map((l) => l.length)) * LH + 3);
      if (this.y - h < BOTTOM) {
        this.newPage();
        head();
      }
      cols.forEach((c, i) => {
        this.rect(xs[i], this.y - h, c.w, h, { thick: bold ? 0.8 : 0.4 });
        ls[i].forEach((t, j) => this.text(t, xs[i] + 3, this.y - 10.5 - j * LH, { size: TEXT - 0.4, bold, align: c.align, w: c.w - 6 }));
      });
      this.y -= h;
    };
    head();
    const all = [...rows];
    while (all.length < (o.minRows ?? 0)) all.push(cols.map(() => ''));
    all.forEach((r) => row(r));
    if (o.sum) row(o.sum, true);
    this.rect(x, this.y, width, 0.1, { thick: 0.8 });
    return width;
  }

  /** liniertes Textfeld mit Beschriftung; mindestens `minLines` Zeilen; läuft über Seiten weiter */
  linedBox(x: number, width: number, label: string, value: string, minLines: number) {
    const lines = this.wrap(value, this.ctx.font, TEXT, width - 10);
    while (lines.length < minLines) lines.push('');
    this.ensure(12 + LH * 2);
    const drawLabel = (cont: boolean) => {
      this.rect(x, this.y - 13, width, 13, { fill: true });
      this.text(`${label}${cont ? ' (Fortsetzung)' : ''}`, x + 3, this.y - 9.5, { size: 7.2, bold: true, color: GRAY });
      this.y -= 13;
    };
    drawLabel(false);
    let top = this.y;
    for (const t of lines) {
      if (this.y - LH < BOTTOM) {
        this.rect(x, this.y, width, top - this.y);
        this.newPage();
        drawLabel(true);
        top = this.y;
      }
      if (t) this.text(t, x + 5, this.y - 9.5);
      this.y -= LH;
      this.line(x, this.y, x + width, this.y, 0.3, LINE);
    }
    this.rect(x, this.y, width, top - this.y);
  }

  /** zwei Unterschriftsfelder nebeneinander (Rahmen, unten Linie mit Beschriftung) */
  signatureBoxes(labels: [string, string], h = 64) {
    this.ensure(h + 8);
    this.y -= 6;
    const w = this.inner / 2;
    labels.forEach((l, i) => {
      const x = M + i * w;
      this.rect(x, this.y - h, w, h);
      this.text(l, x + 4, this.y - 10, { size: 7.5, bold: true, color: GRAY });
      this.line(x + 8, this.y - h + 16, x + w - 8, this.y - h + 16, 0.5, MUTED);
      this.text('Datum, Unterschrift', x + 8, this.y - h + 6, { size: 6.5, color: MUTED });
    });
    this.y -= h;
  }
}

/** Firmenblock: Anschrift (mehrzeilig) links, Logo bzw. Firmenname rechts; liefert y darunter */
export function brand(f: Form, company: string, lines: string, logoRight = true): number {
  let y = f.H - M + 6;
  const ls = lines
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const textBlock = (x: number, align: 'left' | 'right') => {
    const w = f.W / 2 - M;
    if (company) f.text(company, x, y - 11, { size: 10, bold: true, align, w });
    ls.forEach((s, i) => f.text(s, x, y - 22 - i * 9.5, { size: 7.5, color: GRAY, align, w }));
    return 14 + ls.length * 9.5;
  };
  let h = 0;
  if (f.ctx.logo) {
    const lh = 34;
    const lw = Math.min(150, (f.ctx.logo.width / f.ctx.logo.height) * lh);
    const realH = (lw / f.ctx.logo.width) * f.ctx.logo.height;
    f.page.drawImage(f.ctx.logo, { x: logoRight ? f.W - M - lw : M, y: y - realH, width: lw, height: realH });
    h = textBlock(logoRight ? M : f.W / 2, logoRight ? 'left' : 'right');
    h = Math.max(h, realH);
  } else h = textBlock(M, 'left');
  return y - h - 10;
}
