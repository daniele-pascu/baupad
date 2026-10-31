import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import { isoWeekNo, parseDate, weekOf } from './crew';
import { type Box, type ColKey, type FieldKey, type FormLayout, type FormTemplate, MULTILINE } from './form-template';
import { fmtDate, fmtHours, staffTotal, workerHours } from './reports';
import type { Report, ReportItem, ReportWorker, StaffCount } from './types';

/**
 * Firmenformular ausfüllen: Werte eines Berichts in die erkannten Felder des Original-PDFs schreiben (pdf-lib).
 * Einzeilige Felder: Schrift wird verkleinert, bis der Text passt. Mehrzeilige Felder: Umbruch über die
 * Schreiblinien. Tabellen: eine Zeile je Arbeiter; bei Wochenblättern eine Zeile je Arbeiter mit den Stunden
 * in der Spalte des Wochentags (das Datum der Regieliste bestimmt den Wochentag).
 */

export interface FillValues {
  fields: Partial<Record<FieldKey, string>>;
  rows: Partial<Record<ColKey, string>>[];
}

const INK = rgb(0.1, 0.1, 0.45);
const MIN_SIZE = 5.5;

function sanitize(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet());
  const map: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ø: 'o', Ø: 'O', '—': '-', '–': '-', '→': '>', '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'", '…': '...', '€': 'EUR' };
  return [...s.replace(/\r/g, '')].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : (map[ch] ?? (set.has(ch.normalize('NFD')[0].codePointAt(0)!) ? ch.normalize('NFD')[0] : '?')))).join('');
}

/** Text in einen Kasten: Schriftgröße passend, Grundlinie knapp über dem unteren Rand */
function drawInBox(page: PDFPage, font: PDFFont, pageH: number, box: Box, text: string, opts: { max?: number; align?: 'left' | 'right' | 'center' } = {}) {
  const t = sanitize(font, text.trim());
  if (!t) return;
  let size = Math.min(opts.max ?? 9.5, Math.max(MIN_SIZE, box.h * 0.82));
  const avail = Math.max(4, box.w - 2);
  while (size > MIN_SIZE && font.widthOfTextAtSize(t, size) > avail) size -= 0.5;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > avail) s = s.slice(0, -1);
  const w = font.widthOfTextAtSize(s, size);
  const x = opts.align === 'right' ? box.x + box.w - 1 - w : opts.align === 'center' ? box.x + (box.w - w) / 2 : box.x + 1;
  const y = pageH - (box.y + box.h) + Math.max(1.5, (box.h - size) / 2 + size * 0.12);
  page.drawText(s, { x, y, size, font, color: INK });
}

/** Zeilenumbruch auf gegebene Breiten (je Zeile eigene Breite) */
function wrap(font: PDFFont, text: string, size: number, widths: number[]): string[] {
  const out: string[] = [];
  const paras = sanitize(font, text).split('\n');
  let li = 0;
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      li++;
      continue;
    }
    let line = '';
    for (const word of words) {
      const w = widths[Math.min(li, widths.length - 1)] - 2;
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= w || !line) line = probe;
      else {
        out.push(line);
        li++;
        line = word;
      }
    }
    out.push(line);
    li++;
  }
  return out;
}

/** mehrzeiliges Feld: erste Zeile im Kasten, weitere auf den Schreiblinien; bei Platzmangel kleinere Schrift */
function drawLines(page: PDFPage, font: PDFFont, pageH: number, boxes: Box[], text: string) {
  if (!text.trim() || !boxes.length) return;
  const widths = boxes.map((b) => b.w);
  let size = Math.min(9.5, Math.max(MIN_SIZE, boxes[0].h * 0.82));
  let lines = wrap(font, text, size, widths);
  while (lines.length > boxes.length && size > MIN_SIZE) {
    size -= 0.5;
    lines = wrap(font, text, size, widths);
  }
  lines.slice(0, boxes.length).forEach((l, i) => {
    const b = boxes[i];
    let s = l;
    if (i === boxes.length - 1 && lines.length > boxes.length) s = `${s} …`;
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > b.w - 2) s = s.slice(0, -1);
    page.drawText(s, { x: b.x + 1, y: pageH - (b.y + b.h) + Math.max(1.5, (b.h - size) / 2 + size * 0.12), size, font, color: INK });
  });
}

/** PDF der Vorlage mit Werten beschreiben */
export async function fillForm(pdf: ArrayBuffer, layout: FormLayout, values: FillValues): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPage(0);
  const pageH = page.getHeight();
  for (const f of layout.fields) {
    if (!f.key) continue;
    const v = values.fields[f.key];
    if (!v) continue;
    if (MULTILINE.has(f.key) && (f.lines?.length || v.includes('\n'))) drawLines(page, font, pageH, [f.box, ...(f.lines ?? [])], v);
    else drawInBox(page, font, pageH, f.box, v.replace(/\s*\n\s*/g, ' · '));
  }
  const t = layout.table;
  if (t) {
    values.rows.slice(0, t.rows).forEach((row, i) => {
      const y = t.top + i * t.rowHeight;
      for (const c of t.cols) {
        const v = row[c.key];
        if (!v) continue;
        const numeric = c.key !== 'name' && c.key !== 'role';
        drawInBox(page, font, pageH, { x: c.x + 1, y: y + 1, w: c.w - 2, h: t.rowHeight - 2 }, v, { max: numeric ? 8.5 : 9, align: numeric ? 'center' : 'left' });
      }
    });
  }
  return doc.save();
}

/* ───────────── Werte aus Berichten ───────────── */

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : fmtHours(n));
const itemLine = (x: ReportItem) => [x.text.trim(), [x.qty !== null ? x.qty.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '', x.unit].filter(Boolean).join(' ')].filter(Boolean).join(' – ');
const dateFor = (d: string, format?: 'dd.MM.yyyy' | 'dd.MM.') => (format === 'dd.MM.' ? fmtDate(d, false).slice(0, 6) : fmtDate(d, false));

function headValues(r: Report, company: string): Partial<Record<FieldKey, string>> {
  const h = r.head;
  return {
    no: r.no,
    project: [h.project, h.site && h.site !== h.project ? h.site : ''].filter(Boolean).join(' – '),
    site: h.site || h.project,
    number: h.number,
    costCenter: h.costCenter,
    client: h.client,
    address: h.address,
    responsible: h.responsible,
    company,
  };
}

/** Datum je Feld formatieren (Jahr steht ggf. schon im Formular) */
function withDates(layout: FormLayout, fields: Partial<Record<FieldKey, string>>, date: string, weekStart?: string): Partial<Record<FieldKey, string>> {
  const out = { ...fields };
  for (const f of layout.fields) {
    if (f.key === 'date') out.date = weekStart && !date ? `${fmtDate(weekStart, false)} – ${fmtDate(addDaysIso(weekStart, 6), false)}` : dateFor(date, f.dateFormat);
  }
  if (!out.date) out.date = dateFor(date);
  return out;
}

const addDaysIso = (iso: string, n: number) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Personalstand je Funktion. Formulare mit nur „Bauleiter“ bekommen Projektleiter + Techniker + Bautechniker,
 * Formulare mit nur „Vorarbeiter“ bekommen Vorarbeiter + Polier.
 */
function staffValues(staff: StaffCount, layout: FormLayout): Partial<Record<FieldKey, string>> {
  const has = (k: FieldKey) => layout.fields.some((f) => f.key === k);
  const n = (v: number | null | undefined) => v ?? 0;
  const txt = (v: number) => (v ? String(v) : '');
  const leaders = n(staff.projektleiter) + n(staff.techniker) + n(staff.bautechniker);
  const anyLeaderField = has('staff.projektleiter') || has('staff.techniker') || has('staff.bautechniker');
  return {
    'staff.projektleiter': txt(n(staff.projektleiter)),
    'staff.techniker': txt(n(staff.techniker)),
    'staff.bautechniker': txt(n(staff.bautechniker)),
    'staff.bauleiter': txt(anyLeaderField ? 0 : leaders),
    'staff.polier': txt(n(staff.polier)),
    'staff.vorarbeiter': txt(n(staff.vorarbeiter) + (has('staff.polier') ? 0 : n(staff.polier))),
    'staff.facharbeiter': txt(n(staff.facharbeiter)),
    'staff.hilfsarbeiter': txt(n(staff.hilfsarbeiter)),
  };
}

/** Bautagesbericht → Werte */
export function dailyValues(r: Report & { type: 'tag' }, layout: FormLayout, company: string): FillValues {
  const d = r.data;
  const present = d.crew.filter((w) => w.present !== false && w.name.trim());
  const staff = d.staff ?? {};
  const fields: Partial<Record<FieldKey, string>> = {
    ...headValues(r, company),
    from: d.from,
    to: d.to,
    weather: [d.weather, d.tempMin || d.tempMax ? `${[d.tempMin && `min. ${d.tempMin} °C`, d.tempMax && `max. ${d.tempMax} °C`].filter(Boolean).join(', ')}` : ''].filter(Boolean).join(', '),
    'staff.total': staffTotal(d.staff) ? String(staffTotal(d.staff)) : d.crewCount !== null ? String(d.crewCount) : present.length ? String(present.length) : '',
    ...staffValues(staff, layout),
    work: d.work,
    incidents: d.incidents,
    notes: d.notes,
    materials: d.materials.filter((x) => x.text.trim()).map(itemLine).join('\n'),
    equipment: d.equipment.filter((x) => x.text.trim()).map(itemLine).join('\n'),
    acceptanceTime: d.acceptanceTime ?? '',
    acceptanceBy: d.acceptanceBy ?? '',
  };
  return { fields: withDates(layout, fields, r.date), rows: present.map((w) => workerCells(w)) };
}

function workerCells(w: ReportWorker): Partial<Record<ColKey, string>> {
  return { name: w.name, role: w.role, from: w.from, to: w.to, pause: w.pause, hours: num(workerHours(w)), ot50: num(w.ot50 ?? null), ot100: num(w.ot100 ?? null), travel: num(w.travel ?? null) };
}

/** Regieliste (Tagesformular) → Werte */
export function regieValues(r: Report & { type: 'regie' }, layout: FormLayout, company: string): FillValues {
  const d = r.data;
  const fields: Partial<Record<FieldKey, string>> = {
    ...headValues(r, company),
    week: String(isoWeekNo(weekOf(r.date))),
    subject: d.work,
    work: d.work,
    notes: d.notes,
    materials: d.materials.filter((x) => x.text.trim()).map(itemLine).join('\n'),
    equipment: d.equipment.filter((x) => x.text.trim()).map(itemLine).join('\n'),
    travelCosts: d.travelCosts ?? '',
    lodgingCosts: d.lodgingCosts ?? '',
    miscCosts: d.miscCosts ?? '',
  };
  return { fields: withDates(layout, fields, r.date), rows: d.workers.filter((w) => w.name.trim()).map(workerCells) };
}

/**
 * Regieliste als Wochenblatt: alle Regielisten der Kalenderwoche (gleiches Projekt) → eine Zeile je Arbeiter,
 * Stunden in der Spalte des Wochentags (Montag = 0). Angaben aus der ersten Regieliste der Woche.
 */
export function regieWeekValues(reports: (Report & { type: 'regie' })[], weekStart: string, layout: FormLayout, company: string): FillValues {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const fields: Partial<Record<FieldKey, string>> = first
    ? {
        ...headValues(first, company),
        no: uniq(sorted.map((r) => r.no)).join(', '),
        week: String(isoWeekNo(weekStart)),
        subject: uniq(sorted.map((r) => r.data.work)).join('; '),
        work: uniq(sorted.map((r) => r.data.work)).join('\n'),
        notes: uniq(sorted.map((r) => r.data.notes)).join('\n'),
        materials: uniq(sorted.flatMap((r) => r.data.materials.filter((x) => x.text.trim()).map(itemLine))).join('\n'),
        equipment: uniq(sorted.flatMap((r) => r.data.equipment.filter((x) => x.text.trim()).map(itemLine))).join('\n'),
        travelCosts: uniq(sorted.map((r) => r.data.travelCosts ?? '')).join(', '),
        lodgingCosts: uniq(sorted.map((r) => r.data.lodgingCosts ?? '')).join(', '),
        miscCosts: uniq(sorted.map((r) => r.data.miscCosts ?? '')).join(', '),
      }
    : { week: String(isoWeekNo(weekStart)), company };
  // Zeilen je Arbeiter (Name), Stunden je Wochentag summiert
  const rows = new Map<string, Partial<Record<ColKey, string>> & { _h: Record<string, number> }>();
  for (const r of sorted) {
    const day = (parseDate(r.date).getDay() + 6) % 7;
    for (const w of r.data.workers) {
      const name = w.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const row = rows.get(key) ?? { name, role: w.role, _h: {} };
      const add = (k: string, v: number | null | undefined) => {
        if (v === null || v === undefined) return;
        row._h[k] = (row._h[k] ?? 0) + v;
      };
      add(`day:${day}:hours`, workerHours(w));
      add(`day:${day}:ot50`, w.ot50);
      add(`day:${day}:ot100`, w.ot100);
      add(`day:${day}:travel`, w.travel);
      rows.set(key, row);
    }
  }
  const out = [...rows.values()].map((row) => {
    const { _h, ...rest } = row;
    const cells: Partial<Record<ColKey, string>> = { ...rest };
    for (const [k, v] of Object.entries(_h)) cells[k as ColKey] = fmtHours(v);
    // Tagesformular-Spalten (falls die Vorlage keine Wochenspalten hat): Summe der Woche
    const sum = (sub: string) => Object.entries(_h).filter(([k]) => k.endsWith(`:${sub}`)).reduce((s, [, v]) => s + v, 0);
    cells.hours = sum('hours') ? fmtHours(sum('hours')) : '';
    cells.ot50 = sum('ot50') ? fmtHours(sum('ot50')) : '';
    cells.ot100 = sum('ot100') ? fmtHours(sum('ot100')) : '';
    cells.travel = sum('travel') ? fmtHours(sum('travel')) : '';
    return cells;
  });
  const date = first ? first.date : weekStart;
  return { fields: withDates(layout, fields, layout.table?.weekly ? '' : date, weekStart), rows: out };
}

/** Datei für Vorschau/Download */
export async function filledFormFile(template: FormTemplate, pdf: ArrayBuffer, values: FillValues, name: string): Promise<ExportFile> {
  const data = await fillForm(pdf, template.layout, values);
  return { name: `${safeFileName(name)}.pdf`, data, mimeType: 'application/pdf' };
}
