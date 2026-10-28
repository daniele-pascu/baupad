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
  /** Im Dokument ausgewiesene Gesamtsumme der Positionen (vor Nachlass), falls vorhanden */
  total?: number | null;
  /** am Titel erkannte Mehrkostenforderung und ihre Nummer (z. B. „M1-003“) */
  kind?: 'mfk';
  number?: string;
}

/** Deutsche Zahl mit Leerzeichen oder Punkt als Tausendertrennung: „5 150,00“ → 5150 */
export function parseGermanNumber(s: string): number | null {
  const t = s.replace(/[\s.  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const NUM = String.raw`-?\d{1,3}(?:[ .  ]?\d{3})*(?:,\d{1,3})`;
/**
 * Positionsnummer nach ÖNORM, mit Leerzeichen („92 01 01 A“, „00 02 10 01 A“) oder Punkten („03.12.11.26.01.A“,
 * „03.12.11.26.01.K.1“): Stufen aus zwei Ziffern, Positionen enden mit Buchstaben (ggf. mit Ziffer).
 */
const POS_RE = /^\d{2}(?:([ .])\d{2}(?:\1\d{2}){0,3})?(?:[ .][A-Z][A-Z0-9]?(?:\.\d{1,2})?)?$/;
/** Gesamtpreis bei Eventual-/Wahlpositionen oft ausgesternt („************“) */
const QTY_RE = new RegExp(String.raw`^(${NUM})\s+([^\s\d][^\s]{0,7})\s+Einheitspreis\s*:?\s*(${NUM})\s*(?:EUR|€)?\s*(${NUM}|\*{3,})?\s*$`);
/** Mengenzeile „EP | 2 500,00 m² | 8,95 | 22 375,00“ bzw. „EP | 250,00 m | Nicht angeboten“ */
const EP_LINE_RE = new RegExp(String.raw`^EP\s+(${NUM})\s+([^\s\d][^\s]{0,7})\s+(?:(${NUM})(?:\s+(${NUM}|\*{3,}))?|(Nicht angeboten))\s*$`);
/** Summe laut Dokument (vor Nachlass) */
const TOTAL_LABEL_RE = /^(?:Leistungssumme(?: netto)?|Summe|Gesamtpreis(?: in EUR)?|SUMME:?)$/i;
const QTY_ONLY_RE = new RegExp(String.raw`^(${NUM})\s+([^\s\d][^\s]{0,7})$`);
const AMOUNT_RE = new RegExp(String.raw`^${NUM}$`);
/** Kennzeichen-Spalte rechts (z. B. „Z“, „V“, „w Z“) */
const FLAGS_RE = /^(?:(?:[A-Z]|ZZ|w|P)\s*){1,4}$/;
/** Preisanteile „Lohn : 2,00“, „Lohn 6,15“ bzw. „Lohn“ ohne Betrag */
const PRICE_PART_RE = /^(Lohn|Sonstiges|Material|Gerät|Geraet)\s*(?::|-?\d[\d .]*,\d+$|$)/i;

/** Spaltenkopf „Pos. Nr. | Stichwort | Menge Einheit | Einheitspreis | Positionspreis“ u. Ä. */
const TABLE_HEAD_RE = /^(?:Pos(?:ition)?\.?\s*-?\s*Nr\.?|OZ|Position)\b.*\b(?:Einheitspreis|EP)\b.*\b(?:Positionspreis|Gesamtpreis|GP)\b/i;

/**
 * Langtext lesbar machen: im PDF umbrochene Zeilen wieder zu Absätzen zusammenfügen. Ein neuer Absatz beginnt nach
 * Satzende bzw. Doppelpunkt, bei Aufzählungen und bei Kennzeichnungen wie „Eventualposition (E)“.
 */
export function longTextParagraphs(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // im PDF umbrochene Zeilen sind fast so lang wie die längste Zeile; deutlich kürzere Zeilen enden einen Absatz
  // (z. B. Überschrift des Grundtexts)
  const full = Math.max(0, ...lines.map((l) => l.length));
  const out: string[] = [];
  let prevRaw = '';
  for (const line of lines) {
    const prev = out[out.length - 1];
    const own = /^(?:[-–•*·]|\d{1,2}[.)]\s|[a-z]\)\s)/.test(line) || /^(?:Eventualposition|Wahlposition|Nicht angeboten|Leitprodukt|Angebotenes Produkt)\b/.test(line);
    const ended = /[.:;!?)]$/.test(prevRaw) || prevRaw.length < full * 0.7 || /^(?:Eventualposition|Wahlposition|Nicht angeboten)/.test(prevRaw);
    if (!prev || own || ended) out.push(line);
    else if (/[a-zäöüß]-$/.test(prev) && /^[a-zäöüß]/.test(line)) out[out.length - 1] = prev.slice(0, -1) + line;
    else out[out.length - 1] = `${prev} ${line}`;
    prevRaw = line;
  }
  return out;
}

export const KNOWN_UNITS = ['m', 'm2', 'm²', 'm3', 'm³', 'lfm', 'lm', 'Stk', 'St', 'Stück', 'PA', 'psch', 'Psch', 'h', 'Std', 'Wo', 'Tg', 'd', 'Mt', 'kg', 't', 'l', 'VE', 'ME'];

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
  /** Überschriften ohne Buchstaben (Gruppen bzw. Grundtexte) in Reihenfolge */
  const entries: ParsedGroup[] = [];
  const groupSums: Record<string, number> = {};
  const positions: ParsedPosition[] = [];
  let current: (ParsedPosition & { hasQty: boolean; base: boolean }) | null = null;
  /** nach der Mengenzeile gehört weiterer Text nicht mehr zur Position */
  let closed = false;
  /** Grundtext (Überschrift ohne Buchstaben) – gilt für die folgenden Positionen mit dieser Nummer */
  let baseText = { number: '', text: '' };
  const header: string[] = [];
  let docTitle = '';
  let total: number | null = null;

  const finish = () => {
    closed = false;
    if (!current) return;
    if (current.hasQty) positions.push(cleanup(current));
    // Überschrift ohne Menge: Grundtext samt Langtext für die folgenden Positionen merken
    else if (current.base && current.number === baseText.number && current.longText.trim()) baseText.text += `\n${current.longText.trim()}`;
    current = null;
  };

  for (const l of lines) {
    const text = l.cells.join(' ');
    // Spaltenkopf der Tabelle (wiederholt sich nach jedem Seitenumbruch) – gehört nie zum Langtext
    if (TABLE_HEAD_RE.test(text) && !/\d,\d/.test(text)) continue;
    const isData = POS_RE.test(l.cells[0]) || /Einheitspreis/.test(text) || PRICE_PART_RE.test(text) || l.cells[0] === 'EP';
    // Bezeichnung und Summe aus dem Deckblatt / den Kopfdaten
    if (/^(LV-Bezeichnung|Projektbezeichnung)$/.test(l.cells[0]) && l.cells[1] && (!docTitle || l.cells[0] === 'LV-Bezeichnung')) docTitle = l.cells[1];
    if (total === null && l.cells.length >= 2 && TOTAL_LABEL_RE.test(l.cells[0])) total = parseGermanNumber(l.cells[l.cells.length - 1].replace(/\s*(EUR|€)$/, ''));
    if (!isData && repeated.has(key(l))) {
      if (l.page === 1 && l.cells.length === 1) header.push(l.cells[0]);
      continue;
    }
    if (/^Zusammenstellung\b/.test(text.trim())) break;
    const first = l.cells[0];
    if (POS_RE.test(first) && l.cells.length >= 2) {
      const segs = first.split(/[ .]/);
      const li = segs.findIndex((x) => /^[A-Z]/.test(x));
      const lettered = li >= 0;
      const sep = first.length > 2 ? first[2] : ' ';
      const digits = lettered ? segs.slice(0, li) : segs;
      let cells = l.cells.slice(1);
      const last = cells[cells.length - 1];
      // Inhaltsverzeichnis (Seitenzahl am Ende) überspringen
      if (cells.length >= 2 && /^\d{1,3}$/.test(last) && digits.length <= 2 && !lettered) continue;
      // Summenzeile einer Gruppe: „92 01  Markierungen neu  76 083,55“
      if (cells.length >= 2 && AMOUNT_RE.test(last) && !lettered) {
        finish();
        groupSums[first] = parseGermanNumber(last) ?? 0;
        continue;
      }
      // Kennzeichen rechts (z. B. „E“, „Z“, „w Z“); E/W als Eventual-/Wahlposition vermerken
      const flags: string[] = [];
      while (cells.length >= 2 && FLAGS_RE.test(cells[cells.length - 1])) flags.push(...cells.pop()!.split(/\s+/));
      // Kennzeichen „w“ (wesentliche Position) bzw. „ZZ“ kann am Text kleben
      const label = cells.join(' ').replace(/\s+(?:w|ZZ)(?:\s+[A-Z])?$/, '').trim();
      finish();
      if (!lettered) {
        const e = entries.find((g) => g.number === first);
        if (e) e.title = label;
        else entries.push({ number: first, title: label });
        if (digits.length <= 2) {
          baseText = { number: '', text: '' };
          continue;
        }
        // Grundtext; mit Menge darunter auch eine Position (z. B. „92 01 01“)
        baseText = { number: first, text: label };
        current = { number: first, shortText: label, longText: '', unit: '', quantity: null, unitPrice: null, totalPrice: null, group: digits.slice(0, -1).join(sep), issues: [], hasQty: false, base: true };
        continue;
      }
      const kind = flags.includes('E') ? 'Eventualposition (E)' : flags.includes('W') ? 'Wahlposition (W)' : '';
      const base = baseText.number && first.startsWith(baseText.number) ? baseText.text : '';
      current = {
        number: first,
        shortText: label,
        longText: [base, kind].filter(Boolean).map((t) => `${t}\n`).join(''),
        unit: '',
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        // Gruppe = Stufe über dem Grundtext („92 01 01 A“ → „92 01“, „03.12.11.26.01.A“ → „03.12.11.26“)
        group: digits.slice(0, -1).join(sep),
        issues: [],
        hasQty: false,
        base: false,
      };
      continue;
    }
    if (!current || closed) continue;
    if (/^LT\s*\d+$/.test(first)) {
      if (l.cells.length > 1) current.longText += l.cells.slice(1).join(' ') + '\n';
      continue;
    }
    if (PRICE_PART_RE.test(text) || text === 'Frei formulierte Position' || FLAGS_RE.test(text)) continue;
    const ep = EP_LINE_RE.exec(text);
    if (ep) {
      current.quantity = parseGermanNumber(ep[1]);
      current.unit = ep[2];
      current.unitPrice = ep[3] ? parseGermanNumber(ep[3]) : null;
      current.totalPrice = ep[4] && !ep[4].startsWith('*') ? parseGermanNumber(ep[4]) : null;
      if (ep[5]) current.longText += 'Nicht angeboten\n';
      current.hasQty = true;
      closed = true;
      continue;
    }
    const q = QTY_RE.exec(text) ?? QTY_RE.exec(l.cells.slice(0, 2).join(' ') + ' Einheitspreis : ' + (l.cells[3] ?? ''));
    if (q) {
      current.quantity = parseGermanNumber(q[1]);
      current.unit = q[2];
      current.unitPrice = parseGermanNumber(q[3]);
      current.totalPrice = q[4] && !q[4].startsWith('*') ? parseGermanNumber(q[4]) : null;
      current.hasQty = true;
      closed = true;
      continue;
    }
    const qo = QTY_ONLY_RE.exec(text);
    if (qo && l.cells.length <= 2) {
      current.quantity = parseGermanNumber(qo[1]);
      current.unit = qo[2];
      current.hasQty = true;
      closed = true;
      continue;
    }
    current.longText += text + '\n';
  }
  finish();
  // Gruppen: Überschriften, unter denen Positionen liegen (ohne die Grundtexte selbst)
  const within = (group: string, n: string) => group === n || (group.startsWith(n) && /[ .]/.test(group[n.length]));
  const groups = entries.filter((g) => positions.some((p) => within(p.group, g.number)));
  // Titel: Bezeichnung aus den Kopfdaten, sonst erste Kopfzeile, die nicht Firma, Seitenangabe oder Währung ist
  const title = docTitle || (header.find((h) => !/GmbH|\bAG\b|\bKG\b|\bOG\b|Seite|Projekt:|Gedruckt|EUR\s*$|^Positions/.test(h)) ?? header[0] ?? '');
  // anderes Format (z. B. „Kurz-LV“ mit Punkt-Nummern) – nur wenn hier nichts erkannt wurde
  if (!positions.length) {
    const short = parseShortLv(lines, repeated, key);
    if (short.positions.length) return { ...short, title: short.title || title, ...mfkOf(short.title || title) };
  }
  return { title, groups, positions, groupSums, total, ...mfkOf(title, groups[0]?.title ?? '') };
}

/** Mehrkostenforderung am Titel bzw. an der obersten Gruppe erkennen („M1-003.MFK …“, „MKF …“), samt MFK-Nummer */
function mfkOf(...texts: string[]): { kind?: 'mfk'; number?: string } {
  const t = texts.find((x) => /(?:^|[\s.\-_])M(?:FK|KF)\b/i.test(x));
  if (!t) return {};
  const no = /\b(M\d+-\d{2,4})\.?\s*M(?:FK|KF)\b/i.exec(t);
  return no ? { kind: 'mfk', number: no[1] } : { kind: 'mfk' };
}

/** Punkt-Nummer eines Kurz-LV: „02.“, „02.11.21.04“, „02.11.21.07C.“, „S1.12.14.85.03A.2“ bzw. Leistungsgruppe „LG14B“ */
const DOT_NO_RE = /^(?:[A-Z]?\d{1,2}\.(?:\d{2}\.){0,4}(?:\d{2}(?:[A-Z]\.?\d?)?)?|LG\d{2}[A-Z]?)$/;
/** Mengenzelle: [W/E] Menge Einheit [EP [GP]] – GP bei Wahl-/Eventualpositionen oft „********“ */
const SHORT_QTY_RE = new RegExp(String.raw`^(?:([WE])\s+)?(${NUM})\s+([A-Za-zµ][A-Za-z²³23]{0,5})(?:\s+(${NUM})(?:\s+(${NUM}|\*{3,}))?)?$`);

/**
 * Kurz-LV (eine Zeile je Position): „Pos | Kurztext | W/E | ME | EH | EP | GP“, z. B.
 * „02.11.21.07C. | Untergrund f.Verbundestrich aufrauen | 300,00 m² | 4,24 | 1 271,56“.
 * Nummern mit Punkt am Ende sind Gruppen, ohne Menge Grundtexte; Pauschalen ohne Nummer werden mit „o. Nr. …“ übernommen.
 */
function parseShortLv(lines: Line[], repeated: Set<string>, key: (l: Line) => string): ParsedLv {
  const groups: ParsedGroup[] = [];
  const positions: ParsedPosition[] = [];
  let group = '';
  let baseText = { number: '', text: '' };
  let title = '';
  let unnumbered = 0;
  let total: number | null = null;
  for (const l of lines) {
    const text = l.cells.join(' ');
    const numbered = DOT_NO_RE.test(l.cells[0]);
    // Kopf-/Fußzeilen (auf vielen Seiten gleich) – nummerierte Zeilen nie, z. B. „02.14. / 03.14. Besondere …“
    if (!numbered && repeated.has(key(l))) {
      const g = /^Gewerk:\s*(.+)$/.exec(l.cells[0]);
      if (g && !title) title = g[1].trim();
      continue;
    }
    if (/^(SUMME|GESAMT|Zusammenstellung)\b/i.test(text.trim())) {
      const sum = /^SUMME:?$/i.test(l.cells[0]) ? parseGermanNumber(l.cells[l.cells.length - 1]) : null;
      if (sum !== null) total = sum;
      break;
    }
    // Mengenzelle suchen (W/E-Kennzeichen kann davor, EP/GP können in derselben Zelle stehen)
    let qi = -1;
    for (let i = 1; i < l.cells.length; i++) {
      const rest = l.cells.slice(i).join(' ');
      if (SHORT_QTY_RE.test(rest)) {
        qi = i;
        break;
      }
    }
    if (qi < 0) {
      if (!numbered || l.cells.length < 2) continue;
      const number = l.cells[0];
      const label = l.cells.slice(1).join(' ');
      if (number.endsWith('.') || number.startsWith('LG')) {
        const g = groups.find((x) => x.number === number);
        if (g) g.title = label;
        else groups.push({ number, title: label });
        if (!number.startsWith('LG')) group = number;
        baseText = { number: '', text: '' };
      } else baseText = { number, text: label }; // Grundtext für die folgenden Positionen
      continue;
    }
    const q = SHORT_QTY_RE.exec(l.cells.slice(qi).join(' '))!;
    // Pauschalen ohne Nummer (z. B. „Baustelle einrichten“): Nummer „o. Nr. 1“, „o. Nr. 2“ …
    const number = numbered ? l.cells[0] : `o. Nr. ${++unnumbered}`;
    let shortText = (numbered ? l.cells.slice(1, qi) : l.cells.slice(0, qi)).join(' ');
    let flag = q[1] ?? '';
    const f = /^(.*?)\s+([WE])$/.exec(shortText);
    if (f) {
      shortText = f[1];
      flag = flag || f[2];
    }
    const kind = flag === 'W' ? 'Wahlposition (W)' : flag === 'E' ? 'Eventualposition (E)' : '';
    const base = numbered && baseText.number && number.startsWith(baseText.number) ? baseText.text : '';
    const pos = cleanup({
      number,
      shortText: shortText.trim(),
      longText: [base, kind].filter(Boolean).join('\n'),
      unit: q[3],
      quantity: parseGermanNumber(q[2]),
      unitPrice: q[4] ? parseGermanNumber(q[4]) : null,
      totalPrice: q[5] && !q[5].startsWith('*') ? parseGermanNumber(q[5]) : null,
      group: numbered ? group : '',
      issues: [],
      hasQty: true,
    });
    positions.push(pos);
  }
  return { title, groups, positions, groupSums: {}, total };
}

function cleanup(p: ParsedPosition & { hasQty: boolean }): ParsedPosition {
  const issues: string[] = [];
  if (p.quantity === null) issues.push('Menge nicht erkannt');
  if (!p.unit) issues.push('Einheit fehlt');
  else if (!KNOWN_UNITS.some((u) => u.toLowerCase() === p.unit.toLowerCase())) issues.push(`Einheit „${p.unit}“ unbekannt`);
  if (p.unitPrice === null && !/(^|\n)Nicht angeboten(\n|$)/.test(p.longText)) issues.push('Einheitspreis fehlt');
  // EP ist im Ausdruck oft auf Cent gerundet: Abweichung bis Menge × 0,005 € ist Rundung
  if (p.quantity !== null && p.unitPrice !== null && p.totalPrice !== null && Math.abs(p.quantity * p.unitPrice - p.totalPrice) > 0.05 + Math.abs(p.quantity) * 0.005)
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
