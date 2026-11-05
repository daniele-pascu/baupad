import { addDays, isoWeekNo, parseDate, weekOf } from './crew';
import { FIELD_LABELS, type Box, type FieldKey, type FormLayout } from './form-template';
import { uuid } from './ids';

/**
 * Firmenformulare mit frei eingerichteten Feldern: Jede Firma lädt ihre eigenen PDF-Vorlagen hoch und legt selbst
 * fest, wie jeder Kasten heißt, welcher Typ hineingehört, was einzutragen ist und ob das Feld Pflicht ist.
 * Ausgefüllte Formulare (FormEntry) hängen am Projekt und werden je Vorlage und Projekt durchnummeriert.
 * Jeder Eintrag speichert einen Schnappschuss der Felder und die Vorlagenversion – spätere Änderungen an der
 * Vorlage verändern vorhandene Formulare nicht.
 *
 * Koordinaten wie in form-template.ts: PDF-Punkte, Ursprung oben links.
 */

export type CustomFieldType = 'text' | 'multiline' | 'date' | 'week' | 'weekday' | 'time' | 'number' | 'amount' | 'person' | 'project' | 'company' | 'select' | 'checkbox' | 'no';
/** Welche Angabe des Projekts in ein Projektfeld kommt */
export type ProjectSource = 'name' | 'number' | 'address' | 'client' | 'costCenter';

export interface CustomField {
  id: string;
  /** Feldname, z. B. „Baustelle“, „Ausgeführte Arbeiten“ */
  name: string;
  type: CustomFieldType;
  /** Bearbeitungshinweis: was soll hier eingetragen werden? */
  hint?: string;
  required?: boolean;
  /** Schreibbereich auf der ersten Seite */
  box: Box;
  /** mehrzeilig: Anzahl Zeilen (sonst aus Höhe und Schriftgröße berechnet) */
  lines?: number;
  /** mehrzeilig: Zeilenabstand in Punkt (Oberkante zu Oberkante). Gesetzt = jede Zeile ein eigener Streifen. */
  pitch?: number;
  /** mehrzeilig: je Zeile Einzug links und rechts (Punkt, vom Kastenrand) – z. B. erste Zeile nach „Bemerkung:“ */
  lineInsets?: { left: number; right: number }[];
  /** Schriftgröße in Punkt (sonst passend zur Kastenhöhe, max. 9,5) */
  fontSize?: number;
  /** Auswahlfeld: Möglichkeiten */
  options?: string[];
  /** Projektfeld: welche Angabe */
  source?: ProjectSource;
  /** Uhrzeit: aus den Arbeitszeiten der Firma (Wochentag des Datums) – Beginn oder Ende */
  timeOf?: 'from' | 'to';
  /** Datum: Jahr steht schon im Formular → nur Tag.Monat. */
  dateFormat?: 'dd.MM.yyyy' | 'dd.MM.';
  align?: 'left' | 'center' | 'right';
  /** Schriftfarbe (Hex), Standard dunkelblau wie Kugelschreiber */
  color?: string;
  /** Schriftart (die PDF-Standardschriften – wie Arial, Times New Roman, Courier New in Word) */
  font?: FormFont;
  bold?: boolean;
}

export type FormFont = 'helvetica' | 'times' | 'courier';
export const FORM_FONTS: { id: FormFont; label: string; css: string }[] = [
  { id: 'helvetica', label: 'Arial / Helvetica', css: 'Arial, Helvetica, sans-serif' },
  { id: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'courier', label: 'Courier New', css: '"Courier New", Courier, monospace' },
];
/** Ausrichtung eines Feldes (Standard: Zahlen/Beträge rechts, Kästchen mittig, sonst links) */
export const alignOf = (f: Pick<CustomField, 'align' | 'type'>): 'left' | 'center' | 'right' => f.align ?? (f.type === 'amount' || f.type === 'number' ? 'right' : f.type === 'checkbox' ? 'center' : 'left');
export const justifyOf = (f: Pick<CustomField, 'align' | 'type'>) => ({ left: 'flex-start', center: 'center', right: 'flex-end' })[alignOf(f)];
export const fontCss = (f: Pick<CustomField, 'font'>) => FORM_FONTS.find((x) => x.id === (f.font ?? 'helvetica'))!.css;
/** Schriftfarben zur Auswahl */
export const FORM_COLORS: { value: string; label: string }[] = [
  { value: '#1a1a73', label: 'Dunkelblau (Kugelschreiber)' },
  { value: '#000000', label: 'Schwarz' },
  { value: '#1c5fd6', label: 'Blau' },
  { value: '#c92a2a', label: 'Rot' },
  { value: '#2b8a3e', label: 'Grün' },
];
export const DEFAULT_FORM_COLOR = '#1a1a73';

/** Vorschläge für Feldnamen (mit passendem Typ) – oder selbst benennen */
export const NAME_SUGGESTIONS: { name: string; type: CustomFieldType; source?: ProjectSource; timeOf?: 'from' | 'to' }[] = [
  { name: 'Datum', type: 'date' },
  { name: 'KW', type: 'week' },
  { name: 'Wochentag', type: 'weekday' },
  { name: 'Nummer', type: 'no' },
  { name: 'Baustelle', type: 'project', source: 'name' },
  { name: 'Projektnummer', type: 'project', source: 'number' },
  { name: 'Kostenstelle', type: 'project', source: 'costCenter' },
  { name: 'Auftraggeber', type: 'project', source: 'client' },
  { name: 'Adresse', type: 'project', source: 'address' },
  { name: 'Firma', type: 'company' },
  { name: 'Mitarbeiter', type: 'person' },
  { name: 'Verantwortlich', type: 'person' },
  { name: 'Ausgeführte Arbeiten', type: 'multiline' },
  { name: 'Bemerkungen', type: 'multiline' },
  { name: 'Material', type: 'multiline' },
  { name: 'Geräte', type: 'multiline' },
  { name: 'Wetter', type: 'text' },
  { name: 'Arbeitsbeginn', type: 'time', timeOf: 'from' },
  { name: 'Arbeitsende', type: 'time', timeOf: 'to' },
  { name: 'Stunden', type: 'number' },
  { name: 'Betrag', type: 'amount' },
  { name: 'Erledigt', type: 'checkbox' },
];
export const suggestionFor = (name: string) => NAME_SUGGESTIONS.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());

export interface CustomLayout {
  width: number;
  height: number;
  fields: CustomField[];
}

export const FIELD_TYPES: { id: CustomFieldType; label: string; help: string }[] = [
  { id: 'text', label: 'Einzeiliger Text', help: 'Kurzer Text in einer Zeile' },
  { id: 'multiline', label: 'Mehrzeiliger Text', help: 'Längerer Text, Enter = neue Zeile; Zeilenzahl aus der Kastenhöhe' },
  { id: 'date', label: 'Datum', help: 'Datum wählen; passende KW-Felder werden mitgesetzt' },
  { id: 'week', label: 'Kalenderwoche', help: 'Kalenderwoche nach ISO 8601, aus dem Datum berechnet' },
  { id: 'weekday', label: 'Wochentag', help: 'Wochentag (z. B. Montag), aus dem Datum berechnet' },
  { id: 'time', label: 'Uhrzeit', help: 'Uhrzeit, z. B. Arbeitsbeginn/-ende – kommt aus den Arbeitszeiten der Firma für den Wochentag des Datums (änderbar)' },
  { id: 'number', label: 'Zahl', help: 'Zahl, z. B. Stunden oder Stück' },
  { id: 'amount', label: 'Betrag', help: 'Betrag mit zwei Nachkommastellen' },
  { id: 'person', label: 'Mitarbeiter / Personen', help: 'Aus der Arbeiterliste wählen; Vorschlag aus der Arbeitereinteilung' },
  { id: 'project', label: 'Baustelle / Projekt', help: 'Angabe aus dem Projekt (Name, Nummer, Adresse, Auftraggeber, Kostenstelle)' },
  { id: 'company', label: 'Eigene Firma', help: 'Firmenname aus den Firmeninformationen' },
  { id: 'select', label: 'Auswahlfeld', help: 'Eine von mehreren vorgegebenen Möglichkeiten' },
  { id: 'checkbox', label: 'Kontrollkästchen', help: 'Angekreuzt oder leer' },
  { id: 'no', label: 'Laufende Nummer', help: 'Nummer des Formulars, fortlaufend je Formular (über alle Projekte)' },
];
export const typeLabel = (t: CustomFieldType) => FIELD_TYPES.find((x) => x.id === t)?.label ?? t;
export const PROJECT_SOURCES: { id: ProjectSource; label: string }[] = [
  { id: 'name', label: 'Name der Baustelle' },
  { id: 'number', label: 'Projektnummer' },
  { id: 'address', label: 'Adresse' },
  { id: 'client', label: 'Auftraggeber' },
  { id: 'costCenter', label: 'Kostenstelle' },
];

/** Ausgefülltes Formular – hängt am Projekt, speichert Felder und Vorlagenversion als Schnappschuss */
export interface FormEntry {
  id: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  /** Original-PDF der Vorlage (je Version eine Datei) */
  fileId: string;
  layout: CustomLayout;
  projectId: string | null;
  siteName: string;
  /** laufende Nummer je Vorlage (durchgehend über alle Projekte) */
  no: string;
  /** Hauptdatum (erstes Datumsfeld, sonst Anlagedatum) – für Sortierung und Anzeige */
  date: string;
  /** Werte je Feld-ID (Kontrollkästchen: „x“ oder leer; Personen: Namen mit Komma) */
  values: Record<string, string>;
  status: 'draft' | 'done';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export const entrySiteKey = (e: Pick<FormEntry, 'projectId' | 'siteName'>) => (e.projectId ? `p:${e.projectId}` : `n:${e.siteName.trim().toLowerCase()}`);

/** nächste Nummer je Vorlage – durchgehend über alle Projekte (höchste + 1, Lücken bleiben) */
export function nextFormNo(entries: Pick<FormEntry, 'templateId' | 'no'>[], templateId: string): string {
  const max = entries.filter((e) => e.templateId === templateId).reduce((m, e) => Math.max(m, parseInt(e.no, 10) || 0), 0);
  return String(max + 1);
}

/** Nummernbereich „3-20“, „3–5, 8, 10-12“ → Nummern; leer/ungültig → null */
export function parseNoRange(text: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > 2000) return null;
    for (let n = lo; n <= hi; n++) out.add(n);
  }
  return out.size ? out : null;
}

/** doppelte Nummern (zwei Geräte gleichzeitig) – zur Warnung in der Liste */
export function duplicateNos(entries: FormEntry[]): Set<string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const e of entries) {
    const k = `${e.templateId}|${e.no.trim()}`;
    const first = seen.get(k);
    if (first) dup.add(first).add(e.id);
    else seen.set(k, e.id);
  }
  return dup;
}

/** Felder in Leserichtung: Zeilen von oben nach unten (±6 pt), innerhalb von links nach rechts */
export function readingOrder(fields: CustomField[]): CustomField[] {
  const sorted = [...fields].sort((a, b) => a.box.y - b.box.y);
  const rows: CustomField[][] = [];
  for (const f of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].box.y - f.box.y) <= 6) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.box.x - b.box.x));
}

export const MAX_FONT = 9.5;
export const MIN_FONT = 5.5;
/** Schriftgröße eines Feldes (einzeilig: passend zur Höhe; mehrzeilig: 9 pt), sofern nicht fest eingestellt */
export function fontSizeOf(f: CustomField): number {
  if (f.fontSize) return Math.max(MIN_FONT, Math.min(14, f.fontSize));
  if (f.type === 'multiline') return Math.min(9, Math.max(MIN_FONT, f.box.h * 0.82));
  return Math.min(MAX_FONT, Math.max(MIN_FONT, f.box.h * 0.82));
}
export const lineHeightOf = (size: number) => size * 1.32;
/** 1 mm in Punkt */
export const MM_PT = 72 / 25.4;
/** Schrift sitzt 0,5 mm über der Unterkante des Kastens bzw. der Zeile */
export const BASELINE_PT = 0.5 * MM_PT;
/** Höhe einer Schreibzeile für die Schriftgröße (Oberlänge + 0,5 mm Abstand zur Linie) */
export const textBoxHeight = (size: number) => Math.round((size * 1.05 + BASELINE_PT) * 10) / 10;
/** Standard-Zeilenabstand neuer mehrzeiliger Felder: 7 mm */
export const DEFAULT_PITCH = 7 * MM_PT;
/** Zeilenabstand (Punkt) eines mehrzeiligen Feldes */
export const pitchOf = (f: CustomField) => f.pitch ?? f.box.h / lineCapacity(f);
/** Kastenhöhe für Zeilen und Zeilenabstand (letzte Zeile so hoch wie die Schrift) */
export const multiHeight = (lines: number, pitch: number, size: number) => (Math.max(1, lines) - 1) * pitch + textBoxHeight(size);
/**
 * Schriftgröße ändern: einzeilig wächst der Kasten nach oben (Unterkante = Schreiblinie bleibt);
 * mehrzeilig mit Zeilenstreifen bleibt die erste Schreiblinie, die Höhe folgt.
 */
export function withFontSize(f: CustomField, size: number | undefined): CustomField {
  const next: CustomField = { ...f, fontSize: size };
  const s = fontSizeOf(next);
  if (f.type === 'checkbox') return next;
  if (f.type === 'multiline') {
    if (!f.pitch) return next;
    const firstBottom = f.box.y + textBoxHeight(fontSizeOf(f));
    const y = Math.max(0, firstBottom - textBoxHeight(s));
    return { ...next, box: { ...f.box, y, h: multiHeight(lineCapacity(f), f.pitch, s) } };
  }
  const bottom = f.box.y + f.box.h;
  const h = textBoxHeight(s);
  return { ...next, box: { ...f.box, y: Math.max(0, bottom - h), h } };
}
/** Zeilen, die in den Kasten passen */
export function lineCapacity(f: CustomField): number {
  if (f.type !== 'multiline') return 1;
  if (f.lines && f.lines > 0) return f.lines;
  return Math.max(1, Math.floor(f.box.h / lineHeightOf(fontSizeOf(f))));
}
/** Zeilenkästen eines mehrzeiligen Feldes (gleich hoch, von oben nach unten) */
export function lineBoxes(f: CustomField): Box[] {
  const n = lineCapacity(f);
  // Zeilenstreifen mit eigenem Abstand: jede Zeile so hoch wie die Schrift, Abstand = pitch
  if (f.type === 'multiline' && f.pitch) {
    const th = textBoxHeight(fontSizeOf(f));
    return Array.from({ length: n }, (_, i) => {
      const ins = f.lineInsets?.[i];
      const left = Math.max(0, Math.min(f.box.w - 8, ins?.left ?? 0));
      const right = Math.max(0, Math.min(f.box.w - left - 8, ins?.right ?? 0));
      return { x: f.box.x + left, y: f.box.y + i * f.pitch!, w: f.box.w - left - right, h: th };
    });
  }
  const h = f.box.h / n;
  return Array.from({ length: n }, (_, i) => ({ x: f.box.x, y: f.box.y + i * h, w: f.box.w, h }));
}

/** Textbreite in Punkt (Helvetica) – Messfunktion kommt aus forms-pdf.ts bzw. als Näherung aus dem Canvas */
export type Measure = (text: string, size: number) => number;

/** Zeilenumbruch an Wortgrenzen auf die Breite des Kastens; Enter beginnt eine neue Zeile */
export function wrapText(text: string, width: number, size: number, measure: Measure): string[] {
  const out: string[] = [];
  const avail = Math.max(4, width - 2);
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word;
      if (measure(probe, size) <= avail || !line) line = probe;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Umbruch auf die Zeilen eines Feldes – jede Zeile mit ihrer eigenen Breite (Einzüge) */
export function wrapToLines(f: CustomField, text: string, measure: Measure): string[] {
  const widths = lineBoxes(f).map((b) => b.w);
  if (widths.every((w) => w === widths[0])) return wrapText(text, widths[0] ?? f.box.w, fontSizeOf(f), measure);
  const out: string[] = [];
  const size = fontSizeOf(f);
  const wAt = (i: number) => Math.max(4, (widths[Math.min(i, widths.length - 1)] ?? f.box.w) - 2);
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word;
      if (measure(probe, size) <= wAt(out.length) || !line) line = probe;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Passt der Text? Mehrzeilig: Zeilen zählen; einzeilig: Breite bei kleinster Schrift */
export function fits(f: CustomField, value: string, measure: Measure): { ok: boolean; lines: number; capacity: number } {
  if (f.type === 'multiline') {
    const lines = wrapToLines(f, value, measure).length;
    const capacity = lineCapacity(f);
    return { ok: lines <= capacity, lines, capacity };
  }
  const text = displayValue(f, value);
  return { ok: !text || measure(text, MIN_FONT) <= f.box.w - 2, lines: 1, capacity: 1 };
}

/* ───────────── Werte ───────────── */

const pad = (n: number) => String(n).padStart(2, '0');
/** Datum formatiert; Jahr steht ggf. schon im Formular */
export function fmtFieldDate(iso: string, format?: 'dd.MM.yyyy' | 'dd.MM.'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = parseDate(iso);
  return format === 'dd.MM.' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
/** ISO-Kalenderwoche samt Jahr der Woche (Jahreswechsel: 2026-12-31 → KW 53/2026, 2027-01-01 → KW 53/2026) */
export function isoWeek(iso: string): { week: number; year: number } {
  const monday = weekOf(iso);
  return { week: isoWeekNo(monday), year: parseDate(addDays(monday, 3)).getFullYear() };
}
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
/** Wochentag zum Datum, z. B. „Mittwoch“ */
export const weekdayName = (iso: string) => WEEKDAYS[parseDate(iso).getDay()];
export const isoWeekLabel = (iso: string) => {
  const w = isoWeek(iso);
  return `KW ${w.week}/${w.year}`;
};
export const fmtAmount = (v: string) => {
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return v.trim() && Number.isFinite(n) ? n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
};

/** Text, der ins PDF bzw. in die Vorschau kommt */
export function displayValue(f: CustomField, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  switch (f.type) {
    case 'date':
      return fmtFieldDate(v, f.dateFormat);
    case 'amount':
      return fmtAmount(v);
    case 'checkbox':
      return v ? 'X' : '';
    case 'weekday':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? weekdayName(v) : v;
    default:
      return v;
  }
}

/** Angaben, die BauPad beim Anlegen oder bei Änderungen in ein Formular übernimmt */
export interface PrefillContext {
  project?: { name: string; number?: string; address?: string; client?: string; costCenter?: string } | null;
  date?: string;
  company?: string;
  /** Arbeitszeiten der Firma (0 = Montag) – für Uhrzeit-Felder Beginn/Ende */
  workTimes?: ({ from: string; to: string } | null)[];
  /** vorgeschlagene Personen (aus der Arbeitereinteilung) */
  people?: string[];
  no?: string;
}

/** Arbeitsbeginn bzw. -ende laut Arbeitszeiten der Firma am Wochentag des Datums (freier Tag → undefined) */
export function workTimeFor(f: Pick<CustomField, 'timeOf'>, ctx: Pick<PrefillContext, 'date' | 'workTimes'>): string | undefined {
  if (!f.timeOf || !ctx.date || !ctx.workTimes || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.date)) return undefined;
  const t = ctx.workTimes[(parseDate(ctx.date).getDay() + 6) % 7];
  return t ? t[f.timeOf] : undefined;
}

/** Werte aus vorhandenen Angaben – nur, wo das Formular ein passendes Feld hat; fehlt eine Angabe, bleibt das Feld leer */
export function prefill(fields: CustomField[], ctx: PrefillContext, current: Record<string, string> = {}): Record<string, string> {
  const out = { ...current };
  for (const f of fields) {
    let v: string | undefined;
    switch (f.type) {
      case 'project':
        v = ctx.project ? (ctx.project[f.source ?? 'name'] ?? '') : undefined;
        break;
      case 'date':
        v = ctx.date;
        break;
      case 'week':
        v = ctx.date ? String(isoWeek(ctx.date).week) : undefined;
        break;
      case 'weekday':
        v = ctx.date ? weekdayName(ctx.date) : undefined;
        break;
      case 'time':
        v = workTimeFor(f, ctx);
        break;
      case 'company':
        v = ctx.company;
        break;
      case 'person':
        v = ctx.people ? ctx.people.join(', ') : undefined;
        break;
      case 'no':
        v = ctx.no;
        break;
      default:
        v = undefined;
    }
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

/** erstes Datumsfeld (Hauptdatum des Formulars) */
export const mainDate = (fields: CustomField[], values: Record<string, string>): string | null => {
  const f = readingOrder(fields).find((x) => x.type === 'date');
  return f ? values[f.id] || null : null;
};

/** Pflichtfelder ohne Wert */
export const missingRequired = (fields: CustomField[], values: Record<string, string>) => fields.filter((f) => f.required && !(values[f.id] ?? '').trim());

/* ───────────── aus der automatischen Erkennung ───────────── */

const TYPE_OF: Partial<Record<FieldKey, { type: CustomFieldType; source?: ProjectSource; timeOf?: 'from' | 'to' }>> = {
  date: { type: 'date' },
  week: { type: 'week' },
  no: { type: 'no' },
  project: { type: 'project', source: 'name' },
  site: { type: 'project', source: 'name' },
  number: { type: 'project', source: 'number' },
  costCenter: { type: 'project', source: 'costCenter' },
  client: { type: 'project', source: 'client' },
  address: { type: 'project', source: 'address' },
  company: { type: 'company' },
  from: { type: 'time', timeOf: 'from' },
  to: { type: 'time', timeOf: 'to' },
  work: { type: 'multiline' },
  incidents: { type: 'multiline' },
  notes: { type: 'multiline' },
  materials: { type: 'multiline' },
  equipment: { type: 'multiline' },
  travelCosts: { type: 'amount' },
  lodgingCosts: { type: 'amount' },
  miscCosts: { type: 'amount' },
  responsible: { type: 'person' },
};

/** Vorschlag aus der Erkennung (Beschriftungen, Linien): Felder mit Namen und passendem Typ */
export function fieldsFromDetection(layout: FormLayout): CustomField[] {
  return layout.fields.map((f) => {
    const m = f.key ? (TYPE_OF[f.key] ?? { type: f.key.startsWith('staff.') ? ('number' as const) : ('text' as const) }) : { type: 'text' as const };
    const name = f.label.replace(/[:_.\s]+$/g, '').trim() || (f.key ? FIELD_LABELS[f.key] : 'Feld');
    const all = [f.box, ...(f.lines ?? [])];
    const box: Box =
      all.length > 1
        ? { x: Math.min(...all.map((b) => b.x)), y: all[0].y, w: Math.max(...all.map((b) => b.w)), h: all[all.length - 1].y + all[all.length - 1].h - all[0].y }
        : { ...f.box };
    const out: CustomField = { id: uuid(), name, type: m.type, box };
    if (m.source) out.source = m.source;
    if (m.timeOf) out.timeOf = m.timeOf;
    if (all.length > 1) {
      out.type = 'multiline';
      out.lines = all.length;
    }
    if (f.dateFormat) out.dateFormat = f.dateFormat;
    return out;
  });
}

export function newField(box: Box, name = 'Neues Feld'): CustomField {
  return { id: uuid(), name, type: 'text', box };
}
