import { aufmassRows, costCenterLabel, costCentersOf, lvDocsOf, plansOf, positionRef, safeFileName, type ExportFile, type XlsxScope } from './aufmass';
import { hasArea, kindOf, quantityBasis, quantityFor } from './measure';
import type { ProjectState } from './store';
import type { Damage, LvDocument, LvPosition, Plan } from './types';
import { A4_HEIGHT_IN, BLATT_BOTTOM_IN, blank, blattTopMargin, buildXlsx, num, str, type Cell, type HeaderImage, type Sheet } from './xlsx';

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
/** Spalten A–H wie in der Vorlage */
const WIDTHS = [7.22, 9.5, 10.5, 12.22, 10.5, 12.22, 21.22, 3.78];
const COLS = 'ABCDEFGH';

type Item = { plan: Plan; d: Damage };
/** Tabellenart; `areaDepth` = Flächen mit Tiefe als Angabe (Summe m², ohne Position) */
type Kind = 'count' | 'length' | 'area' | 'areaDepth' | 'volume' | 'liter' | 'other';

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
const nrCell = (d: Damage, last: boolean): Cell => (d.label ? str(d.label, last ? 'amCenterLast' : 'amCenter') : num(d.number, last ? 'amCenterLast' : 'amCenter'));
const n = (v: number | null, last: boolean): Cell => (v === null ? blank(last ? 'amNumLast' : 'amText') : num(v, last ? 'amNumLast' : 'amNum'));

/** Leistungszeitraum aus den Messungen (erste bis letzte Erfassung) */
export function defaultPeriod(data: ProjectState, scope: XlsxScope): string {
  const items = aufmassRows(data, plansIn(data, scope));
  const times = items.map((x) => x.damage.createdAt).filter((t) => t > 0);
  const f = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!times.length) return f(Date.now());
  const a = f(Math.min(...times));
  const b = f(Math.max(...times));
  return a === b ? a : `${a} – ${b}`;
}

function plansIn(data: ProjectState, scope: XlsxScope): Plan[] {
  if (scope.kind === 'plan') return [data.plans[scope.planId]];
  if (scope.kind === 'costCenter') return plansOf(data, scope.costCenterId);
  return costCentersOf(data).flatMap((cc) => plansOf(data, cc.id));
}

export function exportAufmassblatt(data: ProjectState, scope: XlsxScope, info: BlattInfo, opts: { logo?: HeaderImage | null } = {}): ExportFile {
  const plans = plansIn(data, scope);
  const items: Item[] = aufmassRows(data, plans).map(({ plan, damage }) => ({ plan, d: damage }));
  const ccs =
    scope.kind === 'plan' ? [data.costCenters[plans[0].costCenterId]].filter(Boolean) : scope.kind === 'costCenter' ? [data.costCenters[scope.costCenterId]] : costCentersOf(data);

  const rows: Cell[][] = [];
  const heights: Record<number, number> = {};
  const merges: string[] = [];
  const add = (cells: Cell[] = [], height?: number) => {
    rows.push(cells);
    if (height) heights[rows.length] = height;
    return rows.length; // Excel-Zeilennummer
  };
  const line = (style: 'amColHead' | 'amRule') => Array.from({ length: 8 }, () => blank(style));

  // Kopf
  add([str(`Aufmaßblatt ${info.no}`, 'amTitle')], 18);
  add();
  const p = data.project;
  add([str('Bauvorhaben', 'amLabel'), null, str([p.name, p.address].filter(Boolean).join(', '), 'amText')]);
  add([str('Kostenstelle', 'amLabel'), null, str(ccs.map((c) => costCenterLabel(c)).filter(Boolean).join(', ') || '–', 'amText')]);
  add([str('Leistungszeitraum', 'amLabel'), null, str(info.period, 'amText')]);
  add();

  // je LV/MFK: Positionen mit Messungen; jede LV/MFK (und das Aufmaß ohne Position) beginnt auf einer neuen Seite
  const starts: number[] = [];
  const assigned = new Set<string>();
  for (const doc of lvDocsOf(data)) {
    const blocks = doc.positions
      .map((pos) => ({ pos, list: items.filter((x) => x.d.positionRef === positionRef(doc.id, pos.id)) }))
      .filter((b) => b.list.length);
    if (!blocks.length) continue;
    blocks.forEach((b) => b.list.forEach((x) => assigned.add(x.d.id)));
    starts.push(rows.length + 1);
    docSection(doc, blocks);
  }

  // Messungen ohne Position: nach Art (Flächen, Linien), Bezug zum Plan über Plan und Nr.
  const free = items.filter((x) => !assigned.has(x.d.id));
  if (free.length) {
    starts.push(rows.length + 1);
    add([str(assigned.size ? 'Aufmaß ohne Leistungsposition' : 'Aufmaß', 'amDoc')], 15.6);
    add([], 6);
    const areas = free.filter((x) => hasArea(kindOf(x.d)) && x.d.area !== null);
    const lines = free.filter((x) => !(hasArea(kindOf(x.d)) && x.d.area !== null));
    if (areas.length) {
      add([str('Flächen', 'amPos')]);
      table(areas, areas.some((x) => x.d.depth !== null) ? 'areaDepth' : 'area');
      add();
    }
    if (lines.length) {
      add([str('Linien und Längen', 'amPos')]);
      table(lines, 'length');
      add();
    }
  }
  if (!items.length) add([str('Noch keine Messungen erfasst.', 'amNote')]);

  /** Abschnitt eines LV bzw. einer MFK */
  function docSection(doc: LvDocument, blocks: { pos: LvPosition; list: Item[] }[]) {
    add([str(`${doc.kind === 'mfk' ? 'MFK' : 'LV'} - ${[doc.number, doc.name].filter(Boolean).join(' ')}`, 'amDoc')], 15.6);
    add([], 15.6);
    const head = line('amColHead');
    head[0] = str('Pos. / Positionstext', 'amColHead');
    head[2] = str('Menge', 'amColHeadR');
    head[3] = str('EH', 'amColHead');
    head[4] = str('Einheitspreis', 'amColHeadR');
    head[6] = str('Positionspreis', 'amColHeadR');
    add(head);
    add([], 6);
    const priceRows: { pos: LvPosition; row: number }[] = [];
    blocks.forEach(({ pos, list }, bi) => {
      // wie Vorlage: Pos.-Nr. normal, Positionstext leicht eingerückt
      add([str(pos.number, 'amText'), null, str(`   ${pos.shortText || ''}`, 'amText')]);
      // Menge verweist auf die Summe der Tabelle (Zeile wird nachgetragen)
      const qtyRow = add([]);
      add();
      const sumRef = table(list, kindOfUnit(pos.unit), pos.unit);
      rows[qtyRow - 1] = [
        null,
        null,
        sumRef ? { t: 'formula', f: sumRef.ref, v: sumRef.value, s: 'amNum' } : blank('amText'),
        str(unitText(pos.unit), 'amText'),
        pos.unitPrice === null ? blank('amText') : num(pos.unitPrice, 'amNum'),
        str('€', 'amText'),
        { t: 'formula', f: `E${qtyRow}*C${qtyRow}`, v: Math.round((sumRef?.value ?? 0) * (pos.unitPrice ?? 0) * 100) / 100, s: 'amNumBold' },
        str('€', 'amBold'),
      ];
      priceRows.push({ pos, row: qtyRow });
      add();
      // zwischen zwei Positionen eine durchgehende Linie, danach ein schmaler Abstand
      if (bi < blocks.length - 1) {
        add(line('amRule'));
        add([], 6);
      } else add();
    });
    // Zusammenstellung (EUR)
    const box = add([str('Zusammenstellung (EUR)', 'amBox'), ...Array.from({ length: 7 }, () => blank('amBox'))], 15.6);
    merges.push(`A${box}:H${box}`);
    add();
    const refs: string[] = [];
    let total = 0;
    priceRows.forEach(({ pos, row }, i) => {
      const v = Math.round((rows[row - 1][6] as { v: number }).v * 100) / 100;
      total += v;
      const r = add([str(pos.number, 'amPos'), null, str(` ${pos.shortText || ''}`, 'amText'), null, null, null, { t: 'formula', f: `G${row}`, v, s: 'amNumBold' }, str('€', 'amBold')]);
      refs.push(`G${r}`);
      if (i < priceRows.length - 1) add();
    });
    add(line('amRule'));
    add();
    add(
      [null, null, null, null, str('Gesamtpreis in EUR', 'amTotal'), null, { t: 'formula', f: refs.join('+') || '0', v: Math.round(total * 100) / 100, s: 'amTotalNum' }, str('€', 'amTotal')],
      15.6,
    );
    add();
  }

  /**
   * Messtabelle passend zur Einheit; liefert die Summenzelle (für die Menge der Position).
   * Stk./m/l: Plan | Nr. | Menge · m²: Plan | Nr. | Länge | Breite | m² · m³: Plan | Nr. | Länge | Breite | Tiefe | m³;
   * Spalte „Bemerkung“ nur, wenn es in der Tabelle etwas zu bemerken gibt.
   */
  function table(list: Item[], kind: Kind, unit = ''): { ref: string; value: number } | null {
    const qtyCol = kind === 'area' ? 4 : kind === 'volume' || kind === 'areaDepth' ? 5 : 2;
    const valueHead =
      kind === 'area' ? ['Länge', 'Breite', 'm²'] : kind === 'areaDepth' ? ['Länge', 'Breite', 'Tiefe', 'm²'] : kind === 'volume' ? ['Länge', 'Breite', 'Tiefe', 'm³'] : [kind === 'other' ? unitText(unit) : unitText(kind === 'count' ? 'Stk' : kind === 'liter' ? 'l' : 'm')];
    const notes = list.map(({ d }) => remark(d, kind));
    const head: Cell[] = [str('Plan', 'amTh'), str('Nr.', 'amTh'), ...valueHead.map((h) => str(h, 'amTh'))];
    if (notes.some(Boolean)) head.push(str('Bemerkung', 'amThNote'));
    add(head);
    const first = rows.length + 1;
    let total = 0;
    list.forEach(({ plan, d }, i) => {
      const last = i === list.length - 1;
      const r = rows.length + 1;
      const note = notes[i];
      let cells: Cell[];
      if (kind === 'area') {
        const v = d.area ?? 0;
        total += v;
        const formula = d.width !== null && !d.areaFromShape;
        cells = [
          n(d.areaFromShape ? null : d.length, last),
          n(d.areaFromShape ? null : d.width, last),
          formula ? { t: 'formula', f: `C${r}*D${r}`, v, s: last ? 'amNumLast' : 'amNum' } : n(d.area, last),
        ];
      } else if (kind === 'areaDepth') {
        const v = d.area ?? 0;
        total += v;
        const formula = d.width !== null && !d.areaFromShape;
        cells = [
          n(d.areaFromShape ? null : d.length, last),
          n(d.areaFromShape ? null : d.width, last),
          n(d.depth, last),
          formula ? { t: 'formula', f: `C${r}*D${r}`, v, s: last ? 'amNumLast' : 'amNum' } : n(d.area, last),
        ];
      } else if (kind === 'volume') {
        const v = d.area !== null && d.depth !== null ? Math.round(d.area * d.depth * 10000) / 10000 : null;
        total += v ?? 0;
        const formula = d.width !== null && d.depth !== null && !d.areaFromShape;
        cells = [
          n(d.areaFromShape ? null : d.length, last),
          n(d.areaFromShape ? null : d.width, last),
          n(d.depth, last),
          formula ? { t: 'formula', f: `C${r}*D${r}*E${r}`, v: v ?? 0, s: last ? 'amNumLast' : 'amNum' } : n(v, last),
        ];
      } else {
        const q = kind === 'liter' ? liters(d) : kind === 'other' ? null : (quantityFor(kind === 'count' ? 'Stk' : 'm', [d]).value ?? null);
        total += q ?? 0;
        cells = [n(q, last)];
      }
      const pn = planNo(plan);
      const planCell: Cell = /^[1-9]\d{0,8}$/.test(pn) ? num(Number(pn), last ? 'amCenterLast' : 'amCenter') : str(pn, last ? 'amCenterLast' : 'amCenter');
      add([planCell, nrCell(d, last), ...cells, note ? str(note, 'amNote') : null]);
    });
    const lastRow = rows.length;
    if (kind === 'other') return null;
    const col = COLS[qtyCol];
    const sum: Cell[] = Array.from({ length: qtyCol }, () => null);
    sum.push({ t: 'formula', f: `SUM(${col}${first}:${col}${lastRow})`, v: Math.round(total * 10000) / 10000, s: 'amNumBold' });
    sum.push(str(valueHead[valueHead.length - 1], 'amBold'));
    const sr = add(sum);
    return { ref: `${col}${sr}`, value: Math.round(total * 10000) / 10000 };
  }

  const sheet: Sheet = {
    name: `Aufmaßblatt ${info.no}`.slice(0, 31),
    rows,
    widths: WIDTHS,
    rowHeights: heights,
    merges,
    print: true,
    pageLayout: true,
    logoLeft: true,
  };
  const breaks = starts.slice(1);
  if (!breaks.length) {
    // ein Abschnitt: immer auf eine Seite (Breite und Höhe)
    sheet.onePage = true;
  } else {
    // mehrere LV/MFK: Seitenumbruch vor jedem weiteren Abschnitt; „auf eine Seite anpassen“ würde die Umbrüche
    // aufheben, daher fester Zoom so, dass auch der längste Abschnitt auf eine Seite passt
    sheet.rowBreaks = breaks;
    const rowH = (r: number) => heights[r] ?? 15;
    const bounds = [1, ...breaks, rows.length + 1];
    const longest = Math.max(...bounds.slice(1).map((end, i) => Array.from({ length: end - bounds[i] }, (_, k) => rowH(bounds[i] + k)).reduce((a, b) => a + b, 0)));
    const usable = (A4_HEIGHT_IN - blattTopMargin(opts.logo) - BLATT_BOTTOM_IN) * 72 * 0.97;
    sheet.scale = Math.max(10, Math.min(100, Math.floor((usable / longest) * 100)));
  }
  const scopeName =
    scope.kind === 'plan' ? [costCenterLabel(ccs[0]), planNo(plans[0])] : scope.kind === 'costCenter' ? [costCenterLabel(ccs[0])] : [];
  return {
    name: `${safeFileName(data.project.name, ...scopeName, `Aufmassblatt_${info.no}`)}.xlsx`,
    data: buildXlsx([sheet], { logo: opts.logo }),
    mimeType: XLSX_MIME,
  };
}

/** Liter aus Fläche × Tiefe (1 m³ = 1000 l); ohne Tiefe nicht berechenbar */
function liters(d: Damage): number | null {
  return hasArea(kindOf(d)) && d.area !== null && d.depth !== null ? Math.round(d.area * d.depth * 1000 * 100) / 100 : null;
}

/** Bemerkung: nur Hinweise (Fläche aus dem Plan, fehlende Werte) – sonst leer */
function remark(d: Damage, kind: Kind): string {
  const parts: string[] = [];
  if (d.areaFromShape) parts.push('Fläche aus Plan');
  if ((kind === 'volume' || kind === 'liter') && d.depth === null) parts.push('ohne Tiefe');
  if (kind === 'area' && d.area === null) parts.push('keine Fläche');
  if (kind === 'other') parts.push('Menge nicht aus Messung ableitbar');
  return parts.join(' · ');
}
