import type { ReportType } from './types';

/**
 * Eigene Firmenformulare (Regieliste, Bautagesbericht, Wochenbericht als PDF der Firma): Erkennung der Felder
 * aus Beschriftungen und Linien der PDF-Seite. Ergebnis ist eine Vorlage mit Feldern (wo welcher Wert steht)
 * und Tabellen (Arbeiterzeilen). Der Admin prüft die Zuordnung in der Vorschau und korrigiert sie bei Bedarf;
 * beim Export schreibt BauPad die Werte in das Original-PDF (form-fill.ts).
 *
 * Koordinaten: PDF-Punkte, Ursprung oben links (wie die Planansicht). Textpositionen: x = linker Rand,
 * y = Grundlinie; bei um 90° gedrehtem Text (rot = 1) läuft der Text von unten nach oben, x ist die Grundlinie.
 */

export interface FormText {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 1;
}
export interface FormSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** Seite eines Formulars, wie pdf.js sie liefert (readFormPage in pdf.ts) */
export interface FormPage {
  width: number;
  height: number;
  texts: FormText[];
  segs: FormSeg[];
}

/** Werte, die BauPad in ein Formular schreiben kann */
export type FieldKey =
  | 'no'
  | 'date'
  | 'week'
  | 'project'
  | 'site'
  | 'number'
  | 'costCenter'
  | 'client'
  | 'address'
  | 'subject'
  | 'company'
  | 'from'
  | 'to'
  | 'weather'
  | 'staff.total'
  | 'staff.bauleiter'
  | 'staff.vorarbeiter'
  | 'staff.facharbeiter'
  | 'staff.hilfsarbeiter'
  | 'staff.lehrling'
  | 'work'
  | 'incidents'
  | 'notes'
  | 'materials'
  | 'equipment'
  | 'travelCosts'
  | 'lodgingCosts'
  | 'miscCosts'
  | 'acceptanceTime'
  | 'acceptanceBy'
  | 'responsible';

export const FIELD_LABELS: Record<FieldKey, string> = {
  no: 'Nummer',
  date: 'Datum',
  week: 'Kalenderwoche',
  project: 'Bauvorhaben / Projekt',
  site: 'Baustelle',
  number: 'Projekt-/Auftragsnummer',
  costCenter: 'Kostenstelle',
  client: 'Auftraggeber',
  address: 'Adresse',
  subject: 'Betrifft',
  company: 'Eigene Firma',
  from: 'Arbeitszeit von',
  to: 'Arbeitszeit bis',
  weather: 'Wetter',
  'staff.total': 'Personalstand gesamt',
  'staff.bauleiter': 'Bauleiter (Anzahl)',
  'staff.vorarbeiter': 'Vorarbeiter (Anzahl)',
  'staff.facharbeiter': 'Facharbeiter (Anzahl)',
  'staff.hilfsarbeiter': 'Hilfsarbeiter (Anzahl)',
  'staff.lehrling': 'Lehrlinge (Anzahl)',
  work: 'Leistungen / Arbeiten',
  incidents: 'Besondere Vorkommnisse',
  notes: 'Bemerkungen',
  materials: 'Material',
  equipment: 'Geräte',
  travelCosts: 'Fahrtkosten',
  lodgingCosts: 'Nächtigungskosten',
  miscCosts: 'Div. Kosten',
  acceptanceTime: 'Schlussabnahme Uhrzeit',
  acceptanceBy: 'Schlussabnahme von',
  responsible: 'Verantwortlich',
};

/** Felder, die über mehrere Zeilen gehen */
export const MULTILINE = new Set<FieldKey>(['work', 'incidents', 'notes', 'materials', 'equipment', 'client', 'address', 'project']);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FormField {
  id: string;
  key: FieldKey | '';
  /** Beschriftung im Formular (zur Anzeige) */
  label: string;
  /** Schreibbereich (einzeilig) bzw. erste Zeile */
  box: Box;
  /** weitere Zeilen (mehrzeilige Felder), jeweils als Schreibbereich */
  lines?: Box[];
  /** Datumsformat: Jahr steht schon im Formular → nur Tag.Monat. */
  dateFormat?: 'dd.MM.yyyy' | 'dd.MM.';
}

/** Spaltenschlüssel einer Arbeitertabelle: Name, Qualifikation, Zeiten, Stunden – oder je Wochentag (0 = Montag) */
export type ColKey = 'name' | 'role' | 'from' | 'to' | 'pause' | 'hours' | 'ot50' | 'ot100' | 'travel' | `day:${number}:${'hours' | 'ot50' | 'ot100' | 'travel'}`;

export interface FormTable {
  /** Zeilenbereich: oberste Zeile und Zeilenhöhe, Anzahl Zeilen */
  top: number;
  rowHeight: number;
  rows: number;
  cols: { key: ColKey; x: number; w: number }[];
  /** Wochenblatt (Spalten je Wochentag) */
  weekly: boolean;
}

export interface FormLayout {
  width: number;
  height: number;
  fields: FormField[];
  table: FormTable | null;
}

export interface FormTemplate {
  id: string;
  type: ReportType;
  name: string;
  /** Datei im Blob-Speicher (Original-PDF) */
  fileName: string;
  layout: FormLayout;
  createdAt: number;
  updatedAt: number;
}

/* ───────────── Beschriftungen erkennen ───────────── */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[:_.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Reihenfolge wichtig: speziellere Muster zuerst */
const LABEL_RULES: { key: FieldKey; re: RegExp }[] = [
  { key: 'staff.bauleiter', re: /bauleiter/ },
  { key: 'staff.vorarbeiter', re: /vorarbeiter|polier/ },
  { key: 'staff.facharbeiter', re: /facharbeiter/ },
  { key: 'staff.hilfsarbeiter', re: /hilfsarbeiter/ },
  { key: 'staff.lehrling', re: /lehrling/ },
  { key: 'staff.total', re: /personalstand|mannschaft|anzahl arbeiter/ },
  { key: 'acceptanceBy', re: /^uhr, von$|abgenommen von/ },
  { key: 'acceptanceTime', re: /schlussabnahme|abnahme/ },
  { key: 'travelCosts', re: /fahrtkosten|fahrt|km/ },
  { key: 'lodgingCosts', re: /nächtigung|übernachtung/ },
  { key: 'miscCosts', re: /div\.? ?kosten|sonstige kosten|sonstiges/ },
  { key: 'incidents', re: /vorkommnisse|behinderungen|ereignisse/ },
  { key: 'notes', re: /vorbemerkungen|bemerkung|anmerkung/ },
  { key: 'work', re: /leistungsbeschreibung|leistungen|ausgeführte arbeiten|tätigkeit|arbeiten/ },
  { key: 'materials', re: /materialaufwand|material/ },
  { key: 'equipment', re: /geräte|gerät/ },
  { key: 'week', re: /kal\.?-?woche|kalenderwoche|^kw$/ },
  { key: 'date', re: /^datum$|^am$|^vom$/ },
  { key: 'number', re: /auftrags-?nr|auftragsnummer|projekt-?nr|projektnummer|bauvorhaben-?nr/ },
  { key: 'costCenter', re: /^kst\b|kostenstelle/ },
  { key: 'no', re: /^nr\b|\bnr\.?\s*_*$|^nummer$|bericht nr|liste nr/ },
  { key: 'client', re: /^auftraggeber$|^bauherr$|^ag$/ },
  { key: 'project', re: /bauvorhaben|^projekt$|^bv$/ },
  { key: 'site', re: /baustelle/ },
  { key: 'address', re: /adresse|anschrift/ },
  { key: 'subject', re: /betrifft|betreff/ },
  { key: 'from', re: /arbeitszeit von|^von$|^beginn$/ },
  { key: 'to', re: /^bis$|^ende$/ },
  { key: 'weather', re: /wetter|witterung/ },
  { key: 'responsible', re: /verantwortlich|bauführer/ },
];

/** Texte, die keine Felder sind (Firmenanschrift, Unterschriften, Titel, Platzhalter-Nullen) */
const IGNORE = /kontrolle|unterschrift|ges\.?m\.?b\.?h|gmbh|@|www\.|^tel\b|^fax\b|^a-\d{4}|^\d{4} [a-zäöü]|in ordnung befunden/i;

export function labelKey(str: string): FieldKey | null {
  const n = norm(str);
  if (!n || IGNORE.test(n)) return null;
  for (const r of LABEL_RULES) if (r.re.test(n)) return r.key;
  return null;
}

/* ───────────── Geometrie-Hilfen ───────────── */

const isH = (s: FormSeg) => Math.abs(s.y1 - s.y2) < 0.6 && Math.abs(s.x2 - s.x1) > 3;
const isV = (s: FormSeg) => Math.abs(s.x1 - s.x2) < 0.6 && Math.abs(s.y2 - s.y1) > 3;
/**
 * Waagrechte Linien; aneinanderstoßende Teilstücke auf gleicher Höhe werden zu einer Linie zusammengefasst –
 * außer an einer senkrechten Linie (dort beginnt eine andere Zelle). Doppelte Striche (Rahmen) zählen einmal.
 */
function hor(page: FormPage): { y: number; x1: number; x2: number }[] {
  const V = ver(page);
  const raw = page.segs.filter(isH).map((s) => ({ y: (s.y1 + s.y2) / 2, x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2) }));
  // nach Höhe bündeln (±1,5 pt), je Bündel nach x sortieren
  const groups: { y: number; items: typeof raw }[] = [];
  for (const h of raw.sort((a, b) => a.y - b.y)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.y - h.y) <= 1.5) g.items.push(h);
    else groups.push({ y: h.y, items: [h] });
  }
  const crossesV = (x: number, y: number) => V.some((v) => Math.abs(v.x - x) <= 2 && v.y1 <= y + 1 && v.y2 >= y - 1);
  const out: { y: number; x1: number; x2: number }[] = [];
  for (const g of groups) {
    for (const h of g.items.sort((a, b) => a.x1 - b.x1)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - h.y) <= 1.5 && h.x1 >= last.x1 && h.x1 <= last.x2 + 3) {
        if (h.x2 <= last.x2 + 0.5) continue; // doppelter Strich
        if (crossesV(h.x1, h.y) && h.x1 >= last.x2 - 2) {
          out.push({ ...h });
          continue;
        }
        last.x2 = Math.max(last.x2, h.x2);
      } else out.push({ ...h });
    }
  }
  return out;
}
const ver = (page: FormPage) => page.segs.filter(isV).map((s) => ({ x: (s.x1 + s.x2) / 2, y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) }));
type HSeg = ReturnType<typeof hor>[number];
type VSeg = ReturnType<typeof ver>[number];

const textRight = (t: FormText) => t.x + t.w;
const textTop = (t: FormText) => t.y - t.h;

/** Zelle um eine Beschriftung: nächste senkrechte Linien links/rechts und waagrechte oben/unten */
function cellAround(t: FormText, H: HSeg[], V: VSeg[], page: FormPage): Box {
  const cy = t.y - t.h / 2;
  const left = V.filter((v) => v.x <= t.x + 1 && v.y1 <= cy && v.y2 >= cy).reduce((m, v) => (v.x > m ? v.x : m), 0);
  const right = V.filter((v) => v.x >= textRight(t) - 1 && v.y1 <= cy && v.y2 >= cy).reduce((m, v) => (v.x < m ? v.x : m), page.width);
  const cx = (Math.max(left, t.x) + Math.min(right, textRight(t))) / 2;
  const top = H.filter((h) => h.y <= textTop(t) + 1 && h.x1 <= cx && h.x2 >= cx).reduce((m, h) => (h.y > m ? h.y : m), 0);
  const bottom = H.filter((h) => h.y >= t.y - 1 && h.x1 <= cx && h.x2 >= cx).reduce((m, h) => (h.y < m ? h.y : m), page.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Schreiblinie rechts neben der Beschriftung (gepunktete/durchgezogene Linie auf Höhe der Grundlinie) */
function underlineAfter(t: FormText, H: HSeg[]): HSeg | null {
  const end = textRight(t);
  const cands = H.filter((h) => h.y >= t.y - 2 && h.y <= t.y + 5 && h.x1 >= end - 3 && h.x1 - end <= 40 && h.x2 - h.x1 >= 15).sort((a, b) => a.x1 - b.x1);
  return cands[0] ?? null;
}

/** weitere volle Schreiblinien unterhalb (für mehrzeilige Felder), bis zur nächsten Beschriftung */
function linesBelow(t: FormText, H: HSeg[], stopY: number, minW: number): HSeg[] {
  return H.filter((h) => h.y > t.y + 5 && h.y < stopY - 2 && Math.abs(h.x1 - t.x) <= 12 && h.x2 - h.x1 >= minW).sort((a, b) => a.y - b.y);
}

let nextId = 1;
const fid = () => `f${nextId++}`;

/* ───────────── Felder ───────────── */

function detectFields(page: FormPage, H: HSeg[], V: VSeg[], labels: { t: FormText; key: FieldKey }[]): FormField[] {
  const out: FormField[] = [];
  const sortedLabels = [...labels].sort((a, b) => a.t.y - b.t.y || a.t.x - b.t.x);
  const yearText = page.texts.find((x) => /^20\d\d$/.test(x.str.trim()) || /^20\d$/.test(x.str.trim()));
  for (const { t, key } of sortedLabels) {
    const lh = Math.max(t.h, 8);
    const u = underlineAfter(t, H);
    const field: FormField = { id: fid(), key, label: t.str.trim(), box: { x: 0, y: 0, w: 0, h: 0 } };
    if (u) {
      field.box = { x: u.x1 + 2, y: u.y - lh - 1, w: Math.max(10, u.x2 - u.x1 - 4), h: lh + 1 };
      // „am ………… 2026“: Jahr steht schon da
      if (key === 'date' && yearText && Math.abs(yearText.y - t.y) < 3 && yearText.x > u.x2 - 5 && yearText.x - u.x2 < 40) field.dateFormat = 'dd.MM.';
    } else {
      const cell = cellAround(t, H, V, page);
      const below = cell.y + cell.h - t.y;
      if (below >= 9 && cell.h - lh >= 9) {
        // Beschriftung oben in der Zelle → Wert darunter
        field.box = { x: Math.max(cell.x + 2, t.x), y: t.y + 1.5, w: cell.x + cell.w - Math.max(cell.x + 2, t.x) - 2, h: cell.y + cell.h - t.y - 3 };
      } else {
        // Wert rechts neben der Beschriftung
        field.box = { x: textRight(t) + 4, y: t.y - lh - 1, w: Math.max(10, cell.x + cell.w - textRight(t) - 6), h: lh + 1 };
      }
    }
    if (MULTILINE.has(key)) {
      // Folgezeilen: Schreiblinien gleicher Breite unterhalb, bis zur nächsten Beschriftung im selben Bereich
      const next = sortedLabels.find((l) => l.t.y > t.y + 4 && l.t.x < field.box.x + field.box.w && textRight(l.t) > t.x);
      const stop = next ? next.t.y - next.t.h - 2 : page.height;
      const firstW = u ? u.x2 - u.x1 : field.box.w;
      const all = linesBelow(t, H, stop, Math.max(40, firstW * 0.6)).filter((h) => (u ? h.y > u.y + 4 : true));
      const more: HSeg[] = [];
      for (const h of all) {
        const ref = more.length ? more[0].x2 - more[0].x1 : h.x2 - h.x1; // Folgezeilen gleich breit wie die erste volle Zeile
        if (Math.abs(h.x2 - h.x1 - ref) > ref * 0.25) break;
        more.push(h);
      }
      if (more.length) {
        if (!u) {
          // ohne Schreiblinie neben der Beschriftung: erste Zeile = Bereich bis zur ersten Linie
          const first = more.shift()!;
          field.box = { x: first.x1 + 2, y: first.y - lh - 1, w: Math.max(10, first.x2 - first.x1 - 4), h: lh + 1 };
        }
        field.lines = more.map((h) => ({ x: h.x1 + 2, y: h.y - lh - 1, w: Math.max(10, h.x2 - h.x1 - 4), h: lh + 1 }));
      } else if (!u && field.box.h > lh * 2.2) {
        // Kasten ohne Linien: in Zeilen aufteilen
        const n = Math.floor(field.box.h / (lh + 3));
        const rowH = field.box.h / n;
        const first = { ...field.box, h: rowH };
        field.lines = Array.from({ length: n - 1 }, (_, i) => ({ x: first.x, y: first.y + rowH * (i + 1), w: first.w, h: rowH }));
        field.box = first;
      }
    }
    out.push(field);
  }
  return out;
}

/* ───────────── Arbeitertabelle ───────────── */

const DAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const SUB: { re: RegExp; key: 'hours' | 'ot50' | 'ot100' | 'travel' }[] = [
  { re: /100 ?%/, key: 'ot100' },
  { re: /50 ?%/, key: 'ot50' },
  { re: /wegzeit|fahrzeit|weg/, key: 'travel' },
  { re: /normal|std|stunden/, key: 'hours' },
];
const COL_RULES: { re: RegExp; key: ColKey }[] = [
  { re: /name|arbeiter|mitarbeiter/, key: 'name' },
  { re: /qualifikation|tätigkeit|funktion/, key: 'role' },
  { re: /^von$|beginn/, key: 'from' },
  { re: /^bis$|ende/, key: 'to' },
  { re: /pause/, key: 'pause' },
  { re: /100 ?%/, key: 'ot100' },
  { re: /50 ?%/, key: 'ot50' },
  { re: /wegzeit|fahrzeit/, key: 'travel' },
  { re: /std|stunden/, key: 'hours' },
];

function detectTable(page: FormPage, H: HSeg[], V: VSeg[], labels: { t: FormText; key: FieldKey }[]): FormTable | null {
  const nameHead = page.texts.find((t) => !t.rot && /name des arbeiters|^name$|^arbeiter$|mitarbeiter/i.test(norm(t.str)));
  if (!nameHead) return null;
  const dayHeads = DAYS.map((d) => page.texts.find((t) => !t.rot && norm(t.str) === d)).filter((t): t is FormText => !!t);
  const weekly = dayHeads.length >= 5;
  // Tabellenrand: senkrechte Linien links der Namensspalte und ganz rechts
  const headY = nameHead.y - nameHead.h / 2;
  const leftX = V.filter((v) => v.x <= nameHead.x + 1 && v.y1 <= headY && v.y2 >= headY).reduce((m, v) => (v.x > m ? v.x : m), 0);
  const tableRight = V.reduce((m, v) => (v.x > m && v.y1 <= headY + 40 && v.y2 >= headY + 40 ? v.x : m), 0) || page.width;
  // Kopfzeile endet unter den (gedrehten) Spaltenköpfen; Datenzeilen bis zur nächsten Beschriftung darunter
  const rotHeads = page.texts.filter((t) => t.rot && t.x > leftX && t.x < tableRight + 1);
  const headBottomY = Math.max(nameHead.y, ...rotHeads.map((t) => t.y)) + 1;
  const nextLabel = labels.map((l) => l.t).filter((t) => t.y > headBottomY + 10 && t.x < tableRight).sort((a, b) => a.y - b.y)[0];
  const stopY = nextLabel ? nextLabel.y - nextLabel.h + 2 : page.height;
  // waagrechte Linien je Höhe zusammenfassen (Zeilenlinien bestehen oft aus mehreren Teilstücken)
  const rowsByY = new Map<number, { x1: number; x2: number }>();
  for (const h of H.filter((h) => h.y >= headBottomY - 2 && h.y <= stopY)) {
    const key = [...rowsByY.keys()].find((y) => Math.abs(y - h.y) <= 1.5) ?? h.y;
    const cur = rowsByY.get(key) ?? { x1: h.x1, x2: h.x2 };
    rowsByY.set(key, { x1: Math.min(cur.x1, h.x1), x2: Math.max(cur.x2, h.x2) });
  }
  const rowLines = [...rowsByY.entries()].filter(([, r]) => r.x1 <= leftX + 40 && r.x2 >= tableRight - 40).map(([y]) => y).sort((a, b) => a - b);
  // doppelte Linien (Ränder) zusammenfassen
  const ys: number[] = [];
  for (const y of rowLines) if (!ys.length || y - ys[ys.length - 1] > 3) ys.push(y);
  if (ys.length < 3) return null;
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  const rowHeight = median(gaps);
  // Spalten aus senkrechten Linien innerhalb der Datenzeilen
  const midY = (ys[0] + ys[1]) / 2;
  const xs: number[] = [];
  for (const x of [...new Set(V.filter((v) => v.x >= leftX - 1 && v.x <= tableRight + 1 && v.y1 <= midY && v.y2 >= midY).map((v) => Math.round(v.x * 2) / 2))].sort((a, b) => a - b)) if (!xs.length || x - xs[xs.length - 1] > 3) xs.push(x);
  if (xs.length < 2) return null;
  const cols: FormTable['cols'] = [];
  const spans = xs.slice(1).map((x, i) => ({ x: xs[i], w: x - xs[i] }));
  // Tagesgruppen: Spalten unter einem Wochentagskopf
  const dayStarts = dayHeads.map((t) => t.x);
  for (const sp of spans) {
    const cx = sp.x + sp.w / 2;
    if (sp.x <= nameHead.x + 1 && sp.x + sp.w >= textRight(nameHead) - 2) {
      cols.push({ key: 'name', x: sp.x, w: sp.w });
      continue;
    }
    // Spaltenkopf: gedrehter Text innerhalb der Spalte oder normaler Text darüber
    const head = rotHeads.find((t) => t.x - t.h <= cx + 1 && t.x >= cx - 1) ?? page.texts.find((t) => !t.rot && t.y < ys[0] && t.y > ys[0] - 60 && t.x <= cx && textRight(t) >= cx);
    const hs = head ? norm(head.str) : '';
    if (weekly) {
      let day = -1;
      for (let i = 0; i < dayStarts.length; i++) if (cx >= dayStarts[i] - 6 && (i === dayStarts.length - 1 || cx < dayStarts[i + 1] - 6)) day = i;
      const sub = SUB.find((s) => s.re.test(hs))?.key;
      if (day >= 0 && sub) cols.push({ key: `day:${day}:${sub}`, x: sp.x, w: sp.w });
    } else {
      const rule = COL_RULES.find((r) => r.re.test(hs));
      if (rule) cols.push({ key: rule.key, x: sp.x, w: sp.w });
    }
  }
  if (!cols.some((c) => c.key === 'name')) return null;
  return { top: ys[0], rowHeight, rows: ys.length - 1, cols, weekly };
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/* ───────────── Erkennung ───────────── */

/** Felder und Tabelle eines Formulars erkennen (reine Berechnung, testbar) */
export function analyzeForm(page: FormPage, type: ReportType): FormLayout {
  nextId = 1;
  const H = hor(page);
  const V = ver(page);
  const labels: { t: FormText; key: FieldKey }[] = [];
  const seen = new Set<FieldKey>();
  for (const t of page.texts.filter((x) => !x.rot).sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (/^[0-9_ ]+$/.test(t.str.trim())) continue;
    if (t.h >= 18) continue; // Titel
    const key = labelKey(t.str);
    if (!key) continue;
    // Beschriftungen mit zwei Teilen („Personalstand: Bauleiter:“) zählen für den zweiten Teil
    if (seen.has(key) && key !== 'date') continue;
    seen.add(key);
    labels.push({ t, key });
  }
  const table = type === 'woche' ? null : detectTable(page, H, V, labels);
  // Beschriftungen, die Teil der Tabelle sind (Wochentage, Name), nicht als Felder
  const fields = detectFields(page, H, V, labels).filter((f) => !(table && f.box.y >= table.top - 2 && f.box.y <= table.top + table.rowHeight * table.rows));
  return { width: page.width, height: page.height, fields, table };
}

/** Beschriftung eines Spaltenschlüssels (Anzeige) */
export function colLabel(key: ColKey): string {
  const m = /^day:(\d):(\w+)$/.exec(key);
  if (m) {
    const day = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][Number(m[1])];
    const sub = { hours: 'Std.', ot50: '50 %', ot100: '100 %', travel: 'Wegzeit' }[m[2] as 'hours' | 'ot50' | 'ot100' | 'travel'];
    return `${day} ${sub}`;
  }
  return { name: 'Name', role: 'Qualifikation', from: 'von', to: 'bis', pause: 'Pause', hours: 'Std.', ot50: '50 %', ot100: '100 %', travel: 'Wegzeit' }[key as Exclude<ColKey, `day:${number}:${string}`>] ?? key;
}
