/**
 * Leistungsverzeichnis (LV) aus PDF-Text lesen.
 *
 * Ausgelegt auf übliche ÖNORM-B-2063-Ausdrucke (z. B. AUER Success, ABK): Positionsnummern
 * „LG ULG GP FP“ (z. B. „92 01 01 B1“), Kurztext in derselben Zeile, Langtext darunter und
 * eine Mengenzeile „5 150,00 m  Einheitspreis : 0,53 EUR  2 729,50“.
 * Alles, was nicht sicher erkannt wird, wird je Position als Hinweis markiert und muss in der
 * Prüfansicht bestätigt bzw. korrigiert werden.
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
}

/** Zeile mit Zellen (Zellen sind durch große Abstände getrennt). */
export interface Line {
  page: number;
  x: number;
  cells: string[];
}

export interface ParsedPosition {
  number: string;
  shortText: string;
  longText: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  /** Nummer der Untergruppe (z. B. „92 01“) */
  group: string;
  issues: string[];
}

export interface ParsedGroup {
  number: string;
  title: string;
}

export interface ParsedLv {
  title: string;
  groups: ParsedGroup[];
  positions: ParsedPosition[];
  /** Im Dokument ausgewiesene Summen je Gruppe (zur Kontrolle) */
  groupSums: Record<string, number>;
}

/** Deutsche Zahl mit Leerzeichen oder Punkt als Tausendertrennung: „5 150,00“ → 5150 */
export function parseGermanNumber(s: string): number | null {
  const t = s.replace(/[\s.  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const NUM = String.raw`-?\d{1,3}(?:[ .  ]?\d{3})*(?:,\d{1,3})`;
const POS_RE = /^(\d{2})(?: (\d{2}))?(?: (\d{2}))?(?: ([A-Z][A-Z0-9]?))?$/;
const QTY_RE = new RegExp(String.raw`^(${NUM})\s+([^\s\d][^\s]{0,7})\s+Einheitspreis\s*:?\s*(${NUM})\s*(?:EUR|€)?\s*(${NUM})?\s*$`);
const QTY_ONLY_RE = new RegExp(String.raw`^(${NUM})\s+([^\s\d][^\s]{0,7})$`);
const AMOUNT_RE = new RegExp(String.raw`^${NUM}$`);
/** Kennzeichen-Spalte rechts (z. B. „Z“, „V“, „w Z“) */
const FLAGS_RE = /^(?:(?:[A-Z]|ZZ|w|P)\s*){1,4}$/;
const PRICE_PART_RE = /^(Lohn|Sonstiges|Material|Gerät|Geraet)\s*:/i;

export const KNOWN_UNITS = ['m', 'm2', 'm²', 'm3', 'm³', 'lfm', 'lm', 'Stk', 'St', 'Stück', 'PA', 'psch', 'Psch', 'h', 'Std', 'Wo', 'Tg', 'Mt', 'kg', 't', 'l', 'VE', 'ME'];

/**
 * Baut aus den Textstücken einer Seite Zeilen (gleiche Höhe) und trennt Spalten an großen
 * Abständen.
 */
export function buildLines(items: TextItem[], page: number): Line[] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y); // PDF: y nach oben
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cur = '';
    let end = -Infinity;
    for (const it of sorted) {
      const charW = it.w / Math.max(1, it.str.length);
      const gap = it.x - end;
      if (cur && gap > Math.max(12, charW * 3)) {
        cells.push(cur.trim());
        cur = it.str;
      } else cur += (cur && gap > charW * 0.25 && !cur.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      end = it.x + it.w;
    }
    if (cur.trim()) cells.push(cur.trim());
    return { page, x: sorted[0].x, cells: cells.map((c) => c.replace(/\s+/g, ' ')) };
  });
}

/** Kopf- und Fußzeilen erkennen: Zeilen, die (ohne Ziffern) auf vielen Seiten gleich vorkommen. */
function repeatedLines(lines: Line[], pages: number): Set<string> {
  const key = (l: Line) => l.cells.join(' ').replace(/\d+/g, '#');
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = key(l);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(l.page);
  }
  const out = new Set<string>();
  if (pages < 2) return out;
  const min = Math.max(2, Math.ceil(pages * 0.5));
  for (const [k, p] of seen) if (p.size >= min) out.add(k);
  return out;
}

export function parseLv(lines: Line[], pageCount: number): ParsedLv {
  const repeated = repeatedLines(lines, pageCount);
  const key = (l: Line) => l.cells.join(' ').replace(/\d+/g, '#');
  const groups: ParsedGroup[] = [];
  const groupSums: Record<string, number> = {};
  const positions: ParsedPosition[] = [];
  let current: (ParsedPosition & { parts: number; hasQty: boolean }) | null = null;
  let currentGroup = '';
  /** Grundtext (3-stellige Nummer) – gilt für die folgenden Folgepositionen */
  let baseText = { number: '', text: '' };
  const header: string[] = [];

  const finish = () => {
    if (!current) return;
    if (current.hasQty || current.parts === 4) {
      if (current.hasQty) positions.push(cleanup(current));
      // 4-stellige Nummer ohne Menge: Vorbemerkung → nicht als Position übernehmen
    }
    current = null;
  };

  for (const l of lines) {
    const isData = POS_RE.test(l.cells[0]) || /Einheitspreis/.test(l.cells.join(' ')) || PRICE_PART_RE.test(l.cells.join(' '));
    if (!isData && repeated.has(key(l))) {
      if (l.page === 1 && l.cells.length === 1) header.push(l.cells[0]);
      continue;
    }
    const text = l.cells.join(' ');
    if (/^Zusammenstellung\b/.test(text.trim())) break;
    const first = l.cells[0];
    const m = POS_RE.exec(first);
    if (m && l.cells.length >= 2) {
      const parts = [m[1], m[2], m[3], m[4]].filter(Boolean).length;
      const number = first;
      let cells = l.cells.slice(1);
      const last = cells[cells.length - 1];
      // Inhaltsverzeichnis (Seitenzahl am Ende) überspringen
      if (cells.length >= 2 && /^\d{1,3}$/.test(last) && parts <= 2) continue;
      // Summenzeile einer Gruppe: „92 01  Systemkompatible Markierungen neu  76 083,55“
      if (cells.length >= 2 && AMOUNT_RE.test(last) && parts <= 3 && !m[4]) {
        finish();
        groupSums[number] = parseGermanNumber(last) ?? 0;
        continue;
      }
      while (cells.length >= 2 && FLAGS_RE.test(cells[cells.length - 1])) cells = cells.slice(0, -1);
      // Kennzeichen „w“ (wesentliche Position) bzw. „ZZ“ kann am Text kleben
      const label = cells.join(' ').replace(/\s+(?:w|ZZ)(?:\s+[A-Z])?$/, '').trim();
      finish();
      if (parts <= 2) {
        if (!groups.some((g) => g.number === number)) groups.push({ number, title: label });
        else groups.find((g) => g.number === number)!.title = label;
        currentGroup = number;
        baseText = { number: '', text: '' };
        continue;
      }
      if (parts === 3) {
        baseText = { number, text: label };
        current = { number, shortText: label, longText: '', unit: '', quantity: null, unitPrice: null, totalPrice: null, group: currentGroup, issues: [], parts, hasQty: false };
        continue;
      }
      current = {
        number,
        shortText: label,
        longText: baseText.number && number.startsWith(baseText.number) ? `${baseText.text}\n` : '',
        unit: '',
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        group: currentGroup,
        issues: [],
        parts,
        hasQty: false,
      };
      continue;
    }
    if (!current) continue;
    if (/^LT\s*\d+$/.test(first)) {
      if (l.cells.length > 1) current.longText += l.cells.slice(1).join(' ') + '\n';
      continue;
    }
    if (PRICE_PART_RE.test(text)) continue;
    const q = QTY_RE.exec(text) ?? QTY_RE.exec(l.cells.slice(0, 2).join(' ') + ' Einheitspreis : ' + (l.cells[3] ?? ''));
    if (q) {
      current.quantity = parseGermanNumber(q[1]);
      current.unit = q[2];
      current.unitPrice = parseGermanNumber(q[3]);
      current.totalPrice = q[4] ? parseGermanNumber(q[4]) : null;
      current.hasQty = true;
      continue;
    }
    const qo = QTY_ONLY_RE.exec(text);
    if (qo && l.cells.length <= 2) {
      current.quantity = parseGermanNumber(qo[1]);
      current.unit = qo[2];
      current.hasQty = true;
      continue;
    }
    current.longText += text + '\n';
  }
  finish();
  // Titel: erste Kopfzeile, die nicht Firma, Seitenangabe oder Währung ist
  const title = header.find((h) => !/GmbH|\bAG\b|\bKG\b|\bOG\b|Seite|Projekt:|Gedruckt|EUR\s*$|^Positions/.test(h)) ?? header[0] ?? '';
  return { title, groups, positions, groupSums };
}

function cleanup(p: ParsedPosition & { parts: number; hasQty: boolean }): ParsedPosition {
  const issues: string[] = [];
  if (p.quantity === null) issues.push('Menge nicht erkannt');
  if (!p.unit) issues.push('Einheit fehlt');
  else if (!KNOWN_UNITS.some((u) => u.toLowerCase() === p.unit.toLowerCase())) issues.push(`Einheit „${p.unit}“ unbekannt`);
  if (p.unitPrice === null) issues.push('Einheitspreis fehlt');
  if (p.quantity !== null && p.unitPrice !== null && p.totalPrice !== null && Math.abs(p.quantity * p.unitPrice - p.totalPrice) > 0.05)
    issues.push('Menge × Einheitspreis ≠ Positionspreis');
  if (!p.shortText) issues.push('Kurztext fehlt');
  return {
    number: p.number,
    shortText: p.shortText,
    longText: p.longText.trim(),
    unit: p.unit,
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    totalPrice: p.totalPrice,
    group: p.group,
    issues,
  };
}

/** Summe der Positionspreise (nur erkannte Preise). */
export function sumPositions(positions: Pick<ParsedPosition, 'totalPrice'>[]): number {
  return Math.round(positions.reduce((s, p) => s + (p.totalPrice ?? 0), 0) * 100) / 100;
}
