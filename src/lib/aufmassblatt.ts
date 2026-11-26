import { round2 } from './numbers';
import { beamText } from './beam';
import { rebarExact, rebarFormula, rebarItemsOf } from './rebar';
import { aufmassRows, byGroup, costCenterLabel, costCentersOf, linesByType, lvDocsOf, plansOf, positionRef, safeFileName, type ExportFile, type XlsxScope } from './aufmass';
import { invoiceLabel, invoiceShort } from './invoices';
import { deductionArea, deductionLength, grossArea, hasArea, kindOf, quantityBasis, quantityFor } from './measure';
import { MEASURE_TYPES, typeOf } from './measure-types';
import { activeRule, bookingFactor } from './pos-rules';
import type { ProjectState } from './store';
import type { Damage, Deduction, LvDocument, LvPosition, Plan } from './types';
import { blank, BLATT_BOTTOM_IN, blattTopMargin, buildXlsx, num, str, type Cell, type HeaderImage, type Sheet, type TableStyle } from './xlsx';

/**
 * Aufmaßblatt nach der Firmenvorlage (AMB): ein Blatt, Kopf mit Aufmaßblatt-Nummer,
 * Bauvorhaben, Kostenstelle und Leistungszeitraum; je LV/MFK die Positionen mit ihren Messungen
 * (Tabelle passend zur Einheit: Stk., m, m², m³, l) und eine Zusammenstellung (EUR).
 * Messungen ohne Position folgen in eigenen Tabellen (Flächen, Linien) – immer mit Plan und Nr.
 * Alle Mengen und Beträge sind Formeln, damit man in Excel weiterrechnen kann.
 */

export interface BlattInfo {
  /** Aufmaßblatt-Nummer, z. B. „001“ */
  no: string;
  /** Leistungszeitraum, z. B. „01.10.2026 – 26.10.2026“ */
  period: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/**
 * Aufbau wie die Firmenvorlage (AMB): Spalten A–J. Messtabelle: A Plan · B Nr. · danach nur die Maße, die die Messart
 * braucht (Länge, Breite/Höhe, Tiefe) · Menge · gleich daneben die Bemerkung. Kopf und Linien einer Tabelle reichen
 * nur über ihre eigenen Spalten – nie über die Blattbreite. Position: C Menge · D Einheit · F Einheitspreis · G € ·
 * I Positionspreis · J €. Die Summe der Breiten passt bei 100 % auf A4 hoch (kein „An Seite anpassen“).
 */
const WIDTHS = [9, 7, 9, 9, 9, 9, 9, 9, 14, 3];
const COLS = 'ABCDEFGHIJ';
/** Zeilenhöhe in Excel (11 pt Schrift) */
const ROW_PT = 15;

/** `factor`: Schadstelle zählt über die Regel der Position mehrfach (Zulage: Zahl der Stufen) */
type Item = { plan: Plan; d: Damage; factor?: number; /** Bewehrungsposition: zählt die bei der Schadstelle eingetragenen lfm */ rebar?: boolean };
/** Tabellenart; `areaDepth` = Flächen mit Tiefe als Angabe (Summe m², ohne Position); `free` = freie Menge mit eigener Einheit */
type Kind = 'count' | 'length' | 'area' | 'areaDepth' | 'volume' | 'liter' | 'other' | 'free';

function kindOfUnit(unit: string): Kind {
  const u = unit.trim().toLowerCase().replace(/[\s.]/g, '');
  if (['l', 'ltr', 'liter'].includes(u)) return 'liter';
  return quantityBasis(unit) ?? 'other';
}

/** Einheit wie in der Vorlage geschrieben */
function unitText(unit: string): string {
  const k = kindOfUnit(unit);
  return k === 'count' ? 'Stk.' : k === 'area' ? 'm²' : k === 'volume' ? 'm³' : k === 'length' ? 'm' : k === 'liter' ? 'l' : unit || 'EH';
}

const planNo = (p: Plan) => p.planNumber || p.planName;
const nrCell = (d: Damage): Cell => (d.label ? str(d.label, 'amTC') : num(d.number, 'amTC'));
/** Maß (Länge, Breite, Tiefe) */
const n = (v: number | null, ded = false): Cell => (v === null ? null : num(v, ded ? 'amTD' : 'amTN'));
/** Menge (Ergebnis-Spalte der Messtabelle) – angezeigt mit zwei Nachkommastellen */
const qn = (v: number | null): Cell => (v === null ? null : num(v, 'amTQ'));
/** Messzeile: Plan, Nr., Maße und Menge lückenlos – die Bemerkung steht gleich in der nächsten Spalte */
const measureRow = (lead: Cell[], rest: Cell[], note: Cell = null): Cell[] => [...lead, ...rest, note];
/** Zeile über die ersten `count` Spalten: fehlende Zellen bekommen das Format `style` (z. B. Linie unten) */
const fillRow = (cells: Cell[], style: Parameters<typeof blank>[0], count = COLS.length): Cell[] => Array.from({ length: Math.max(count, cells.length) }, (_, i) => cells[i] ?? (i < count ? blank(style) : null));
/**
 * Messzeilen einfärben: jede zweite Zeile getönt, unter der letzten eine Linie – nur über die Spalten der Tabelle
 * (`rows` = die Zeilen der Tabelle ohne Kopf)
 */
const styleTable = (rows: Cell[][], count: number) => {
  // wiederholte Kopfzeilen (neue Seite) bleiben, wie sie sind
  const body = rows.filter((row) => row[0]?.s !== 'amTHead');
  body.forEach((row, k) => {
    const suffix = `${k % 2 ? 'b' : ''}${k === body.length - 1 ? 'l' : ''}`;
    for (let i = 0; i < count; i++) {
      const c = row[i];
      row[i] = c ? { ...c, s: `${c.s}${suffix}` as TableStyle } : blank(`amTC${suffix}` as TableStyle);
    }
  });
};

/** Leistungszeitraum aus den Messungen (erste bis letzte Erfassung) */
/** Umfang des Aufmaßblatts: wie beim Excel-Export, zusätzlich eine Rechnung (alle ihre Pläne) */
/** 'plans': frei zusammengestellte Pläne (auch aus mehreren Kostenstellen) auf einem Aufmaßblatt */
export type BlattScope = XlsxScope | { kind: 'invoice'; invoiceId: string } | { kind: 'plans'; planIds: string[] };

const invoiceOf = (data: ProjectState, scope: BlattScope) => (scope.kind === 'invoice' ? data.project.invoices?.find((i) => i.id === scope.invoiceId) : undefined);

export function defaultPeriod(data: ProjectState, scope: BlattScope): string {
  const inv = invoiceOf(data, scope);
  if (inv?.period) return inv.period;
  const items = aufmassRows(data, plansIn(data, scope));
  const times = items.map((x) => x.damage.createdAt).filter((t) => t > 0);
  const f = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!times.length) return f(Date.now());
  const a = f(Math.min(...times));
  const b = f(Math.max(...times));
  return a === b ? a : `${a} – ${b}`;
}

export function plansIn(data: ProjectState, scope: BlattScope): Plan[] {
  if (scope.kind === 'plan') return [data.plans[scope.planId]];
  if (scope.kind === 'plans') {
    // Reihenfolge wie in der Planliste: Kostenstelle, dann Plannummer
    const want = new Set(scope.planIds);
    return costCentersOf(data).flatMap((cc) => plansOf(data, cc.id).filter((p) => want.has(p.id)));
  }
  if (scope.kind === 'invoice') return costCentersOf(data).flatMap((cc) => plansOf(data, cc.id, scope.invoiceId));
  if (scope.kind === 'costCenter') return plansOf(data, scope.costCenterId);
  return costCentersOf(data).flatMap((cc) => plansOf(data, cc.id));
}

/**
 * `opts.prices === false`: ohne Einheits-/Positionspreise und ohne Zusammenstellung (Benutzer ohne Freigabe
 * „Preise und Summen“) – Mengen und Messtabellen bleiben.
 */
export function exportAufmassblatt(data: ProjectState, scope: BlattScope, info: BlattInfo, opts: { logo?: HeaderImage | null; prices?: boolean } = {}): ExportFile & { /** das Blatt selbst – für die Vorschau */ sheet: Sheet } {
  const prices = opts.prices !== false;
  const plans = plansIn(data, scope);
  const items: Item[] = aufmassRows(data, plans).map(({ plan, damage }) => ({ plan, d: damage }));
  const ccs =
    scope.kind === 'plan'
      ? [data.costCenters[plans[0].costCenterId]].filter(Boolean)
      : scope.kind === 'costCenter'
        ? [data.costCenters[scope.costCenterId]]
        : scope.kind === 'invoice' || scope.kind === 'plans'
          ? costCentersOf(data).filter((c) => plans.some((p) => p.costCenterId === c.id))
          : costCentersOf(data);
  const inv = invoiceOf(data, scope);

  const rows: Cell[][] = [];
  const merges: string[] = [];
  // Seitenumbrüche setzt das Blatt selbst (A4 hoch, 100 %): nur so kann eine lange Tabelle auf jeder neuen Seite wieder
  // mit ihrer Kopfzeile (Plan | Nr. | …) beginnen. Gerechnet wird mit der Zeilenhöhe von Excel (15 pt, größere Schrift
  // etwas mehr) und einer Zeile Reserve – die Zeilenhöhen selbst bleiben frei.
  const PAGE_PT = 841.89 - (blattTopMargin(opts.logo) + BLATT_BOTTOM_IN) * 72 - ROW_PT;
  /** Seitenumbruch vor diesen Zeilen (1-basiert) */
  const breaks: number[] = [];
  /** belegte Höhe der laufenden Seite */
  let used = 0;
  let breakNext = false;
  const heightOf = (cells: Cell[]) => (cells.some((c) => c?.s === 'amTitle') ? 21 : cells.some((c) => c?.s === 'amDoc' || c?.s === 'amBox' || c?.s === 'amTotal') ? 17.5 : ROW_PT);
  /** passt die nächste Zeile nicht mehr auf die Seite? */
  const pageFull = (h = ROW_PT) => breakNext || used + h > PAGE_PT;
  /** die nächsten `n` Zeilen gehören zusammen (Überschrift, Tabellenkopf, erste Zeilen): passen sie nicht, neue Seite */
  const keepTogether = (n: number) => {
    if (used > 0 && used + n * ROW_PT > PAGE_PT) breakNext = true;
  };
  const add = (cells: Cell[] = []) => {
    const h = heightOf(cells);
    if (pageFull(h) && rows.length) {
      breaks.push(rows.length + 1);
      used = 0;
    }
    breakNext = false;
    used += h;
    return rows.push(cells); // Excel-Zeilennummer
  };
  /** Abschnittstitel (LV/MFK bzw. Aufmaß ohne Position): fett, ohne Linie über das Blatt */
  const section = (title: string) => {
    keepTogether(8);
    add([str(title, 'amDoc')]);
    add([]);
  };
  /** Titel einer Messtabelle ohne Position (Messart, z. B. „Länge“): fett – kein Balken über die Blattbreite */
  const band = (label: string) => {
    keepTogether(4); // Titel, Tabellenkopf und zwei Zeilen zusammen
    return add([str(label, 'amPos')]);
  };

  // Kopf: Titel, darunter die Angaben zum Blatt (Beschriftung in A, Wert ab C – ohne Kasten und ohne verbundene Zellen)
  add([str(`Aufmaßblatt ${info.no}${inv ? ` – ${invoiceLabel(inv)}` : ''}`, 'amTitle')]);
  add([]);
  const p = data.project;
  const infoRow = (label: string, value: string) => add([str(label, 'amLabel'), null, str(value, 'amPos')]);
  infoRow('Bauvorhaben', [p.name, p.address].filter(Boolean).join(', '));
  infoRow('Kostenstelle', ccs.map((c) => costCenterLabel(c)).filter(Boolean).join(', ') || '–');
  // Leistungszeitraum nur, wenn einer eingetragen ist (keine leere Zeile im Kopf)
  if (info.period.trim()) infoRow('Leistungszeitraum', info.period);
  add([]);

  // je LV/MFK: die Positionen mit ihren Messungen, am Ende die Zusammenstellung mit dem Gesamtpreis
  const assigned = new Set<string>();
  for (const doc of lvDocsOf(data)) {
    const blocks = doc.positions
      .map((pos) => {
        // von Hand zugeordnet oder automatisch über die Regel der Position (Größe, Tiefe, Zulage mit Stufen)
        const ref = positionRef(doc.id, pos.id);
        const rebar = !!activeRule(pos)?.rebar;
        return { pos, list: items.flatMap((x): Item[] => ((f) => (f > 0 ? [{ ...x, factor: f, rebar: rebar && x.d.positionRef !== ref }] : []))(bookingFactor(data, x.d, ref))) };
      })
      .filter((b) => b.list.length);
    if (!blocks.length) continue;
    blocks.forEach((b) => b.list.forEach((x) => assigned.add(x.d.id)));
    docSection(doc, blocks);
  }

  // Messungen ohne Position: je Messart eine Tabelle (wie in der App), Bezug zum Plan über Plan und Nr.
  const free = items.filter((x) => !assigned.has(x.d.id));
  if (free.length) {
    section('Aufmaß');
    // Flächenmessung ohne Fläche (nur die Länge erfasst, z. B. ein Riss): zählt wie bisher als Länge
    const onlyLength = (x: Item) => hasArea(kindOf(x.d)) && x.d.area === null && typeOf(x.d) !== 'volumen';
    for (const type of MEASURE_TYPES) {
      const all = free.filter((x) => (type.id === 'laenge' ? typeOf(x.d) === 'laenge' || onlyLength(x) : typeOf(x.d) === type.id && !onlyLength(x)));
      // jede „Neue Messung“ (Messgruppe) ist eine eigene Tabelle – nie mit einer anderen zusammen, auch bei gleicher Messart
      for (const group of byGroup(all)) {
        const list = group.items;
        const title = group.title ?? type.label;
        if (type.id === 'frei') {
          // freie Mengen: je Einheit eine Tabelle
          const units = [...new Set(list.map((x) => (x.d.unit ?? '').trim()))];
          for (const u of units) {
            band(u ? `${title} (${u})` : title);
            table(list.filter((x) => (x.d.unit ?? '').trim() === u), 'free', u);
            add([]);
          }
          continue;
        }
        if (type.id === 'laenge') {
          // Linien je Linienart getrennt (durchgezogen, Wellenlinie, gestrichelt …) – verschiedene Arten nie in einer Summe
          for (const g of linesByType(list)) {
            band(g.only ? title : `${title} – ${g.label}`);
            table(g.items, 'length');
            add([]);
          }
          continue;
        }
        band(title);
        const kind: Kind = type.id === 'stueck' ? 'count' : type.id === 'volumen' ? 'volume' : list.some((x) => x.d.depth !== null) ? 'areaDepth' : 'area';
        table(list, kind, '', type.id === 'wand' ? { width: 'Höhe', depth: 'Stärke' } : undefined);
        add([]);
      }
    }
  }
  if (!items.length) add([str('Noch keine Messungen erfasst.', 'amNote')]);

  // Bewehrung je Messnummer: eine Zeile, lfm als Formel aus allen Längen (z. B. =2*0,2+3*0,2+0,54+3*0,9), darunter die Summe
  const rebarItems = items.filter((x) => (x.d.rebar ?? 0) > 0);
  if (rebarItems.length) {
    band('Bewehrung');
    const head = [str('Plan', 'amTHead'), str('Nr.', 'amTHead'), str('lfm', 'amTHead')];
    add(head);
    const first = rows.length + 1;
    let total = 0;
    rebarItems.forEach(({ plan, d }) => {
      const parts = rebarItemsOf(d);
      const v = rebarExact(parts);
      total += v;
      if (pageFull()) add(head); // neue Seite: Kopfzeile wiederholen
      add([planCell(plan), nrCell(d), { t: 'formula', f: rebarFormula(parts), v, s: 'amTQ' }]);
    });
    const col = 'C';
    styleTable(rows.slice(first - 1), 3);
    add([null, null, { t: 'formula', f: `SUM(${col}${first}:${col}${rows.length})`, v: Math.round(total * 10000) / 10000, s: 'amQtyBold' }, str('lfm', 'amBold')]);
    add([]);
  }

  function planCell(plan: Plan): Cell {
    const pn = planNo(plan);
    return /^[1-9]\d{0,8}$/.test(pn) ? num(Number(pn), 'amTC') : str(pn, 'amTC');
  }

  /**
   * Abschnitt eines LV bzw. einer MFK wie in der Vorlage: Titel, Spaltenkopf „Pos. / Positionstext · Menge · EH ·
   * Einheitspreis · Positionspreis“, je Position zwei Zeilen (Nummer und Text; Menge, Einheit, Einheitspreis,
   * Positionspreis) und darunter ihre Messtabelle. Am Ende die Zusammenstellung mit dem Gesamtpreis (nur mit Preisen).
   */
  function docSection(doc: LvDocument, blocks: { pos: LvPosition; list: Item[] }[]) {
    const title = `${doc.kind === 'mfk' ? 'MFK' : 'LV'} - ${[doc.number, doc.name].filter(Boolean).join(' ')}`;
    section(title);
    add(
      prices
        ? fillRow([str('Pos. / Positionstext', 'amColHead'), null, str('Menge', 'amColHeadR'), str('EH', 'amColHead'), null, str('Einheitspreis', 'amColHeadR'), null, null, str('Positionspreis', 'amColHeadR')], 'amColHead')
        : fillRow([str('Pos. / Positionstext', 'amColHead'), null, str('Menge', 'amColHeadR'), str('EH', 'amColHead')], 'amColHead', 4),
    );
    add([]);
    /** Zeile mit Menge und Preis je Position (für die Zusammenstellung) */
    const priceRows: number[] = [];
    let total = 0;
    blocks.forEach(({ pos, list }) => {
      const text = pos.shortText || '';
      keepTogether(6); // Position, Menge, Tabellenkopf und zwei Zeilen zusammen
      add([str(pos.number, 'amPos'), null, str(text, 'amText')]);
      const qr = add([]);
      priceRows.push(qr);
      add([]);
      const kind = kindOfUnit(pos.unit);
      // immer nach Messart getrennt: je Messart eine eigene Tabelle (bei mehreren mit Überschrift)
      const groups = MEASURE_TYPES.map((t) => ({ type: t, items: list.filter((x) => typeOf(x.d) === t.id) })).filter((g) => g.items.length);
      const sums = groups.flatMap((g) => {
        if (groups.length > 1) band(g.type.label);
        // Flächen mit Tiefe: Spalte „Tiefe“ zur Angabe (Menge bleibt m²)
        const sum = table(g.items, kind === 'area' && g.items.some((x) => x.d.depth !== null) ? 'areaDepth' : kind, pos.unit, g.type.id === 'wand' ? { width: 'Höhe', depth: 'Stärke' } : undefined);
        add([]);
        return sum ? [sum] : [];
      });
      const value = Math.round(sums.reduce((a, x) => a + x.value, 0) * 10000) / 10000;
      const price = Math.round(value * (pos.unitPrice ?? 0) * 100) / 100;
      total += price;
      // Menge verweist auf die Summe(n) der Tabellen, Positionspreis = Einheitspreis × Menge
      rows[qr - 1] = [
        null,
        null,
        sums.length ? { t: 'formula', f: sums.map((x) => x.ref).join('+'), v: value, s: 'amNum' } : null,
        str(unitText(pos.unit), 'amText'),
        ...(prices
          ? [null, pos.unitPrice === null ? null : num(pos.unitPrice, 'amNum'), str('€', 'amText'), null, { t: 'formula', f: `F${qr}*C${qr}`, v: price, s: 'amNumBold' } as Cell, str('€', 'amBold')]
          : []),
      ];
      add([]);
    });
    if (!prices) return;
    // Zusammenstellung: Titel im Kasten über A–J, je Position der Positionspreis, darunter der Gesamtpreis
    keepTogether(Math.min(40, 4 + blocks.length * 2)); // möglichst auf einer Seite
    const box = add(fillRow([str(title, 'amBox')], 'amBox'));
    merges.push(`A${box}:J${box}`);
    add([]);
    const firstSum = rows.length + 1;
    blocks.forEach(({ pos }, i) => {
      const cells: Cell[] = [str(pos.number, 'amPos'), null, str(pos.shortText || '', 'amText')];
      cells[8] = { t: 'formula', f: `I${priceRows[i]}`, v: Math.round((rows[priceRows[i] - 1][8] as { v: number }).v * 100) / 100, s: 'amNumBold' };
      cells[9] = str('€', 'amBold');
      add(Array.from(cells, (c) => c ?? null));
      add([]);
    });
    const lastSum = rows.length;
    add([]);
    const totalCells: Cell[] = [];
    totalCells[5] = str('Gesamtpreis in EUR', 'amTotal');
    totalCells[8] = { t: 'formula', f: `SUM(I${firstSum}:I${lastSum})`, v: Math.round(total * 100) / 100, s: 'amTotalNum' };
    totalCells[9] = str('€', 'amTotal');
    add(Array.from(totalCells, (c) => c ?? null));
    add([]);
    add([]);
  }

  /**
   * Messtabelle: Plan | Nr. | nur die Maße der Messart | Menge (Kopf = Einheit) | … | Bemerkung (Stk./m/l: nur die
   * Menge · m²: Länge, Breite · m²/m³ mit Tiefe: Länge, Breite, Tiefe). Spalte „Bemerkung“ nur, wenn es etwas zu bemerken gibt. Liefert die Summenzelle
   * (für die Menge der Position).
   */
  function table(list: Item[], kind: Kind, unit = '', labels: { width?: string; depth?: string } = {}): { ref: string; value: number } | null {
    const areaTable = kind === 'area' || kind === 'areaDepth' || kind === 'volume';
    const withDepth = kind === 'areaDepth' || kind === 'volume';
    const unitHead =
      kind === 'area' || kind === 'areaDepth' ? 'm²' : kind === 'volume' ? 'm³' : kind === 'free' ? unit || 'Menge' : kind === 'other' ? unitText(unit) : unitText(kind === 'count' ? 'Stk' : kind === 'liter' ? 'l' : 'm');
    // Zeilen: je Messung eine Zeile, darunter ihre Abzüge/Zuschläge (Tür, Öffnung …) – Flächen-Tabellen
    // (Teilflächen) bzw. Längen-Tabellen (Teillängen von Linien)
    const dedsOf = (d: Damage) => (areaTable ? (d.area !== null ? d.deductions : undefined) : kind === 'length' && kindOf(d) === 'line' ? d.deductions : undefined) ?? [];
    type Line = { item: Item; ded?: Deduction };
    const steps = (item: Item) => (item.factor ?? 1) > 1;
    // Zulage (mehrere Stufen): eine Zeile mit der Nettomenge × Stufen – die Abzüge stehen bei der Grundposition
    const lines: Line[] = list.flatMap((item) => [{ item }, ...(steps(item) ? [] : dedsOf(item.d)).map((ded) => ({ item, ded }))]);
    const notes = lines.map(({ item, ded }) =>
      ded
        ? dedNote(ded, !areaTable)
        : [item.rebar ? 'Bewehrung der Schadstelle' : '', steps(item) ? `${item.factor} Stufen${item.d.depth !== null ? ` (Tiefe ${Math.round(item.d.depth * 1000 * 10) / 10} mm)` : ''}` : '', remark(item.d, kind)]
            .filter(Boolean)
            .join(' · '),
    );
    // nur die Maße dieser Messart (m²: Länge, Breite · m³: Länge, Breite, Tiefe · m/Stk./l: keine), Menge gleich danach
    const keep = areaTable ? (withDepth ? [0, 1, 2] : [0, 1]) : [];
    const compact = (c: Cell[]) => [...keep.map((k) => c[k]), c[3]];
    const qtyCol = COLS[2 + keep.length];
    /** Spalten der Tabelle (Plan, Nr., Maße, Menge) – Kopf und Linien reichen nur so weit */
    const tableCols = 3 + keep.length;
    // Kopf grau hinterlegt; „Bemerkung“ gleich daneben. Läuft die Tabelle über die Seite, steht der Kopf auf jeder
    // neuen Seite wieder oben.
    const head = measureRow(
      [str('Plan', 'amTHead'), str('Nr.', 'amTHead')],
      compact([str('Länge', 'amTHead'), str(labels.width ?? 'Breite', 'amTHead'), str(labels.depth ?? 'Tiefe', 'amTHead'), str(unitHead, 'amTHead')]),
      notes.some(Boolean) ? str('Bemerkung', 'amThNote') : null,
    );
    keepTogether(3);
    add(head);
    const first = rows.length + 1;
    let total = 0;
    lines.forEach(({ item, ded }, i) => {
      const { plan, d } = item;
      if (pageFull()) add(head); // neue Seite: Kopfzeile wiederholen
      const r = rows.length + 1;
      const note = notes[i];
      const q = (v: number, f: string): Cell => ({ t: 'formula', f, v, s: ded ? 'amTDQ' : 'amTQ' });
      const noteCell: Cell = note ? str(note, 'amNote') : null;
      if (ded) {
        // Teilfläche mit Vorzeichen: Abzug negativ, Zuschlag positiv (Anzahl als Faktor)
        const sign = `${ded.add ? '' : '-'}${ded.count > 1 ? `${ded.count}*` : ''}`;
        const a = deductionArea(ded);
        let cells: Cell[];
        if (!areaTable) {
          // Linie: Teillänge mit Vorzeichen (Anzahl × Länge steht in der Bemerkung)
          const v = deductionLength(ded);
          total += v;
          cells = [null, null, null, num(v, 'amTDQ')];
        } else if (kind === 'volume') {
          const v = d.depth !== null ? (a < 0 ? -1 : 1) * round2(Math.abs(a) * d.depth) : null;
          total += v ?? 0;
          cells = [n(ded.length, true), n(ded.width ?? null, true), n(d.depth, true), v === null ? qn(null) : q(v, `${sign}ROUND(ROUND(C${r}*D${r},2)*E${r},2)`)];
        } else {
          total += a;
          cells = [n(ded.length, true), n(ded.width ?? null, true), null, q(a, `${sign}ROUND(C${r}*D${r},2)`)];
        }
        // Abzug/Zuschlag: ohne Plan und Nr. – was es ist, steht in der Bemerkung („Abzug Tür“)
        add(measureRow([null, null], compact(cells), noteCell));
        return;
      }
      let cells: Cell[];
      const baseUnit = kind === 'area' || kind === 'areaDepth' ? 'm²' : kind === 'volume' ? 'm³' : kind === 'count' ? 'Stk' : kind === 'length' ? 'm' : null;
      if (item.rebar) {
        // Bewehrungsposition: Länge der Bewehrung, die bei der Schadstelle eingetragen ist
        const qty = d.rebar ?? null;
        total += qty ?? 0;
        add(measureRow([planCell(plan), nrCell(d)], compact([null, null, null, qn(qty)]), noteCell));
        return;
      }
      if (steps(item) && baseUnit) {
        // Zulage: Stufen × Nettomenge der Schadstelle (als Formel, damit man die Stufen sieht)
        const base = quantityFor(baseUnit, [d]).value;
        const v = base === null ? null : Math.round(item.factor! * base * 10000) / 10000;
        total += v ?? 0;
        const qty = v === null ? qn(null) : q(v, `${item.factor}*${base}`);
        cells = areaTable ? [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), withDepth ? n(d.depth) : null, qty] : [null, null, null, qty];
        add(measureRow([planCell(plan), nrCell(d)], compact(cells), noteCell));
        return;
      }
      // Bruttofläche (Länge × Breite bzw. aus dem Plan); die Abzüge folgen in eigenen Zeilen
      const g = grossArea(d);
      if (kind === 'area' || kind === 'areaDepth') {
        const v = g ?? 0;
        total += v;
        const formula = d.width !== null && !d.areaFromShape;
        cells = [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), kind === 'areaDepth' ? n(d.depth) : null, formula ? q(v, `ROUND(C${r}*D${r},2)`) : qn(g)];
      } else if (kind === 'volume') {
        const v = g !== null && d.depth !== null ? round2(g * d.depth) : null;
        total += v ?? 0;
        const formula = d.width !== null && d.depth !== null && !d.areaFromShape;
        cells = [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), n(d.depth), formula ? q(v ?? 0, `ROUND(ROUND(C${r}*D${r},2)*E${r},2)`) : qn(v)];
      } else {
        // Linie mit Abzügen: gemessene Länge, die Abzüge folgen in eigenen Zeilen
        const qty =
          kind === 'free'
            ? (d.qty ?? null)
            : kind === 'liter'
              ? liters(d)
              : kind === 'other'
                ? null
                : kind === 'length' && dedsOf(d).length
                  ? d.length
                  : (quantityFor(kind === 'count' ? 'Stk' : 'm', [d]).value ?? null);
        total += qty ?? 0;
        cells = [null, null, null, qn(qty)];
      }
      add(measureRow([planCell(plan), nrCell(d)], compact(cells), noteCell));
    });
    const lastRow = rows.length;
    // jede zweite Zeile getönt, Linie unter der letzten Zeile – nur über die Spalten der Tabelle
    styleTable(rows.slice(first - 1), tableCols);
    if (kind === 'other') return null;
    const col = qtyCol;
    const value = Math.round(total * 10000) / 10000;
    // Summe unter der Mengenspalte, die Einheit gleich daneben (wie in der Vorlage)
    const sr = add([null, null, ...compact([null, null, null, { t: 'formula', f: `SUM(${col}${first}:${col}${lastRow})`, v: value, s: 'amQtyBold' }]), str(unitHead, 'amBold')]);
    return { ref: `${col}${sr}`, value };
  }

  const { widths, scale } = fitColumns(rows);
  const sheet: Sheet = {
    name: `Aufmaßblatt ${info.no}`.slice(0, 31),
    rows,
    widths,
    merges,
    print: true,
    pageLayout: true,
    // wie die Vorlage: A4 hoch in 100 % – nie „an Seite anpassen“ (sonst rutscht eine lange Liste verkleinert auf ein Blatt,
    // sobald man eine Spalte ändert); lange Listen laufen auf die nächste Seite (Umbrüche siehe `add`)
    scale,
    rowBreaks: breaks,
    logoLeft: true,
    headerCenter: `Aufmaßblatt ${info.no}`,
  };
  const scopeName =
    scope.kind === 'plan' || (scope.kind === 'plans' && plans.length === 1)
      ? [costCenterLabel(ccs[0]), planNo(plans[0])]
      : scope.kind === 'costCenter' || (scope.kind === 'plans' && ccs.length === 1)
        ? [costCenterLabel(ccs[0]), ...(scope.kind === 'plans' ? [`${plans.length}_Plaene`] : [])]
        : scope.kind === 'plans'
          ? [`${plans.length}_Plaene`]
          : inv
            ? [invoiceShort(inv).replace(' ', '')]
            : [];
  return {
    name: `${safeFileName(data.project.name, ...scopeName, `Aufmassblatt_${info.no}`)}.xlsx`,
    data: buildXlsx([sheet], { logo: opts.logo }),
    mimeType: XLSX_MIME,
    sheet,
  };
}

/**
 * Spaltenbreiten passend zum Inhalt: jede Zahl und jede Summe hat Platz (nie „###“), Plan und Nr. werden nicht
 * abgeschnitten. Wird das Blatt dadurch breiter als die Seite, geben zuerst die Füllspalten G und H Platz ab; reicht
 * auch das nicht, wird der Ausdruck so weit verkleinert, dass die Breite auf eine Seite passt.
 */
export function fitColumns(rows: Cell[][]): { widths: number[]; scale: number } {
  const widths = [...WIDTHS];
  const total = widths.reduce((a, b) => a + b, 0); // passt bei 100 % auf A4 hoch
  for (const row of rows)
    row.forEach((c, i) => {
      if (!c || i >= widths.length || c.t === 'blank') return;
      const s = c.s ?? '';
      const bold = /Bold|Total|THead/.test(s) ? 1.12 : 1;
      const big = /Total/.test(s) ? 1.1 : 1;
      let need = 0;
      // Zahl im Buchhaltungsformat: Tausenderpunkte, zwei Nachkommastellen, Platz für Vorzeichen und Rand
      if (c.t !== 'str') need = (/^amTC/.test(s) ? String(c.v).length : c.v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length + 1.5) * bold * big + 1.5;
      // Text, der nicht in die Nachbarzelle laufen kann (Tabellenkopf, Plan, Nr.)
      else if (/^amT(C|Head)/.test(s)) need = c.v.length * bold + 1.5;
      if (need > widths[i]) widths[i] = Math.ceil(need * 2) / 2;
    });
  let over = widths.reduce((a, b) => a + b, 0) - total;
  for (const i of [7, 6]) {
    const give = Math.max(0, Math.min(over, widths[i] - 3));
    widths[i] -= give;
    over -= give;
  }
  return { widths, scale: over > 0 ? Math.max(50, Math.floor((100 * total) / (total + over))) : 100 };
}

/** Liter aus Fläche × Tiefe (1 m³ = 1000 l); ohne Tiefe nicht berechenbar */
function liters(d: Damage): number | null {
  return hasArea(kindOf(d)) && d.area !== null && d.depth !== null ? Math.round(d.area * d.depth * 1000 * 100) / 100 : null;
}

/** Bemerkung einer Abzugs- bzw. Zuschlagszeile, z. B. „Abzug Tür (2×)“ */
function dedNote(x: Deduction, line = false): string {
  const m = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const size = line ? `(${x.count > 1 ? `${x.count} × ` : ''}${m(x.length)} m)` : x.count > 1 ? `(${x.count}×)` : '';
  // „Abzug Tür (2×)“ – die Zeile hat keine eigene Nummer
  return [x.add ? 'Zuschlag' : 'Abzug', x.label?.trim(), size].filter(Boolean).join(' ');
}

/** Bemerkung: Notiz und Hinweise auf fehlende Werte – sonst leer (dass ein Maß aus dem Plan stammt, steht nicht da) */
function remark(d: Damage, kind: Kind): string {
  const parts: string[] = [];
  if (d.beam) parts.push(beamText(d.beam));
  if (d.note?.trim()) parts.push(d.note.trim());
  if ((kind === 'volume' || kind === 'liter') && d.depth === null) parts.push('ohne Tiefe');
  if (kind === 'area' && d.area === null) parts.push('keine Fläche');
  if (kind === 'other') parts.push('Menge nicht aus Messung ableitbar');
  return parts.join(' · ');
}
