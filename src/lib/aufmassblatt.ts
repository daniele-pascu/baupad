import { round2 } from './numbers';
import { rebarExact, rebarFormula, rebarItemsOf } from './rebar';
import { deductionNumbers } from './numbering';
import { aufmassRows, costCenterLabel, costCentersOf, lvDocsOf, plansOf, positionRef, safeFileName, type ExportFile, type XlsxScope } from './aufmass';
import { invoiceLabel, invoiceShort } from './invoices';
import { deductionArea, deductionLength, grossArea, hasArea, kindOf, quantityBasis, quantityFor } from './measure';
import { MEASURE_TYPES, typeOf } from './measure-types';
import { activeRule, bookingFactor } from './pos-rules';
import type { ProjectState } from './store';
import type { Damage, Deduction, LvDocument, LvPosition, Plan } from './types';
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
/**
 * Spalten A–J, in allen Tabellen gleich belegt:
 * A Plan · B Nr. · C Länge · D Breite/Höhe · E Tiefe · F Menge · G Einheit · H Einheitspreis bzw. Bemerkung · I Positionspreis · J Rand
 */
const WIDTHS = [10, 7, 9.5, 9.5, 9.5, 11.5, 6.5, 12, 13.5, 1.5];
const COLS = 'ABCDEFGHIJ';
/** Spalte F: Menge (Ergebnis jeder Messzeile, Summe der Tabelle, Menge der Position) */
const QTY = 5;

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
const nrCell = (d: Damage): Cell => (d.label ? str(d.label, 'amRowCenter') : num(d.number, 'amRowCenter'));
/** Maß (Länge, Breite, Tiefe); `ded` = Zeile eines Abzugs bzw. Zuschlags */
const n = (v: number | null, ded = false): Cell => (v === null ? blank('amRowBlank') : num(v, ded ? 'amDedNum' : 'amRowNum'));
/** Tiefe in Metern: Millimeter bleiben sichtbar (0,061) */
const dn = (v: number | null): Cell => (v === null ? blank('amRowBlank') : num(v, 'amRowDepth'));
/** Menge (Ergebnis-Spalte der Messtabelle) mit 3 Nachkommastellen wie in der Vorlage */
const qn = (v: number | null): Cell => (v === null ? blank('amRowBlank') : num(v, 'amRowQty'));
/** Zeile über alle Spalten: fehlende Zellen bekommen das Format `style` (durchgehende Linie bzw. Fläche) */
const fillRow = (cells: Cell[], style: Parameters<typeof blank>[0]): Cell[] => Array.from({ length: COLS.length }, (_, i) => cells[i] ?? blank(style));
/** Zeilenhöhe für umbrochenen Text in verbundenen Zellen (ca. `perLine` Zeichen je Zeile) */
const wrapHeight = (text: string, perLine: number, base: number) => base + (Math.max(1, Math.ceil(text.length / perLine)) - 1) * 14;

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
export function exportAufmassblatt(data: ProjectState, scope: BlattScope, info: BlattInfo, opts: { logo?: HeaderImage | null; prices?: boolean } = {}): ExportFile {
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
  const heights: Record<number, number> = {};
  const merges: string[] = [];
  const add = (cells: Cell[] = [], height?: number) => {
    rows.push(cells);
    if (height) heights[rows.length] = height;
    return rows.length; // Excel-Zeilennummer
  };
  /** Abschnittstitel mit Linie darunter (LV/MFK bzw. Aufmaß ohne Position) */
  const section = (title: string) => {
    add(fillRow([str(title, 'amSection')], 'amSection'), 19);
    add([], 5);
  };
  /** heller Balken über die ganze Breite (Position bzw. Messart) */
  const band = (label: string) => add(fillRow([str(label, 'amBandFirst')], 'amBand'), 18);

  // Kopf: Titel, darunter ein Kasten mit den Angaben zum Blatt
  add([str(`Aufmaßblatt ${info.no}${inv ? ` – ${invoiceLabel(inv)}` : ''}`, 'amTitleBig')], 24);
  add([], 6);
  const p = data.project;
  const infoRow = (label: string, value: string) => {
    const r = add(fillRow([str(label, 'amInfoLabel'), blank('amInfoLabel'), str(value, 'amInfoValue')], 'amInfoValue'), wrapHeight(value, 62, 16.5));
    merges.push(`A${r}:B${r}`, `C${r}:J${r}`);
  };
  infoRow('Bauvorhaben', [p.name, p.address].filter(Boolean).join(', '));
  infoRow('Kostenstelle', ccs.map((c) => costCenterLabel(c)).filter(Boolean).join(', ') || '–');
  const planNames = plans.filter(Boolean).map(planNo);
  if (planNames.length) infoRow(planNames.length === 1 ? 'Plan' : 'Pläne', planNames.length > 12 ? `${planNames.slice(0, 12).join(', ')} … (${planNames.length} Pläne)` : planNames.join(', '));
  infoRow('Leistungszeitraum', info.period);
  add([], 10);

  // je LV/MFK: Zusammenstellung, dann die Positionen mit ihren Messungen; jede LV/MFK (und das Aufmaß ohne Position) beginnt auf einer neuen Seite
  const starts: number[] = [];
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
    starts.push(rows.length + 1);
    docSection(doc, blocks);
  }

  // Messungen ohne Position: je Messart eine Tabelle (wie in der App), Bezug zum Plan über Plan und Nr.
  const free = items.filter((x) => !assigned.has(x.d.id));
  if (free.length) {
    starts.push(rows.length + 1);
    section(assigned.size ? 'Aufmaß ohne Leistungsposition' : 'Aufmaß');
    // Flächenmessung ohne Fläche (nur die Länge erfasst, z. B. ein Riss): zählt wie bisher als Länge
    const onlyLength = (x: Item) => hasArea(kindOf(x.d)) && x.d.area === null && typeOf(x.d) !== 'volumen';
    for (const type of MEASURE_TYPES) {
      const list = free.filter((x) => (type.id === 'laenge' ? typeOf(x.d) === 'laenge' || onlyLength(x) : typeOf(x.d) === type.id && !onlyLength(x)));
      if (!list.length) continue;
      if (type.id === 'frei') {
        // freie Mengen: je Einheit eine Tabelle
        const units = [...new Set(list.map((x) => (x.d.unit ?? '').trim()))];
        for (const u of units) {
          band(u ? `Frei (${u})` : 'Frei');
          table(list.filter((x) => (x.d.unit ?? '').trim() === u), 'free', u);
          add([], 10);
        }
        continue;
      }
      band(type.label);
      const kind: Kind = type.id === 'laenge' ? 'length' : type.id === 'stueck' ? 'count' : type.id === 'volumen' ? 'volume' : list.some((x) => x.d.depth !== null) ? 'areaDepth' : 'area';
      table(list, kind, '', type.id === 'wand' ? { width: 'Höhe', depth: 'Stärke' } : undefined);
      add([], 10);
    }
  }
  if (!items.length) add([str('Noch keine Messungen erfasst.', 'amNote')]);

  // Bewehrung je Messnummer: eine Zeile, lfm als Formel aus allen Längen (z. B. =2*0,2+3*0,2+0,54+3*0,9), darunter die Summe
  const rebarItems = items.filter((x) => (x.d.rebar ?? 0) > 0);
  if (rebarItems.length) {
    band('Bewehrung');
    add(fillRow([str('Plan', 'amHead'), str('Nr.', 'amHead'), null, null, null, str('lfm', 'amHeadR')], 'amHead'), 15);
    const first = rows.length + 1;
    let total = 0;
    rebarItems.forEach(({ plan, d }) => {
      const parts = rebarItemsOf(d);
      const v = rebarExact(parts);
      total += v;
      add(fillRow([planCell(plan), nrCell(d), null, null, null, { t: 'formula', f: rebarFormula(parts), v, s: 'amRowQty' }], 'amRowBlank'));
    });
    const col = COLS[QTY];
    add(fillRow([str('Summe', 'amSumLabel'), null, null, null, null, { t: 'formula', f: `SUM(${col}${first}:${col}${rows.length})`, v: Math.round(total * 10000) / 10000, s: 'amSumQty' }, str('lfm', 'amSumUnit')], 'amSumBlank'));
    add([], 10);
  }

  function planCell(plan: Plan): Cell {
    const pn = planNo(plan);
    return /^[1-9]\d{0,8}$/.test(pn) ? num(Number(pn), 'amRowCenter') : str(pn, 'amRowCenter');
  }

  /**
   * Abschnitt eines LV bzw. einer MFK: zuerst die Zusammenstellung (je Position Menge, Einheit, Einheitspreis,
   * Positionspreis und der Gesamtpreis – nur mit Preisen), dann je Position ein heller Balken (Nr., Text, Menge,
   * Einheit, Einheitspreis, Positionspreis) und darunter die Messtabelle. Die Zusammenstellung verweist auf die Balken.
   */
  function docSection(doc: LvDocument, blocks: { pos: LvPosition; list: Item[] }[]) {
    const title = `${doc.kind === 'mfk' ? 'MFK' : 'LV'} - ${[doc.number, doc.name].filter(Boolean).join(' ')}`;
    section(title);
    // Zeilen der Zusammenstellung reservieren – gefüllt werden sie, sobald die Balken der Positionen feststehen
    let sumRows: number[] = [];
    let totalRow = 0;
    if (prices) {
      add(
        fillRow([str('Pos.', 'amHeadL'), null, str('Leistung', 'amHeadL'), null, null, str('Menge', 'amHeadR'), str('EH', 'amHead'), str('Einheitspreis', 'amHeadR'), str('Positionspreis', 'amHeadR')], 'amHead'),
        15,
      );
      sumRows = blocks.map(({ pos }) => add([], wrapHeight(pos.shortText || '', 34, 16)));
      totalRow = add([], 20);
      add([], 14);
    }
    let total = 0;
    blocks.forEach(({ pos, list }, i) => {
      const text = pos.shortText || '';
      const bandRow = add([], wrapHeight(text, 30, 18));
      merges.push(`A${bandRow}:B${bandRow}`, `C${bandRow}:E${bandRow}`);
      // Flächen mit Tiefe: Spalte „Tiefe“ zur Angabe (Menge bleibt m²)
      const kind = kindOfUnit(pos.unit);
      const sumRef = table(list, kind === 'area' && list.some((x) => x.d.depth !== null) ? 'areaDepth' : kind, pos.unit);
      const value = sumRef?.value ?? 0;
      const price = Math.round(value * (pos.unitPrice ?? 0) * 100) / 100;
      total += price;
      // Balken: Menge verweist auf die Summe der Tabelle, Positionspreis = Einheitspreis × Menge
      rows[bandRow - 1] = fillRow(
        [
          str(pos.number, 'amBandFirst'),
          null,
          str(text, 'amBand'),
          null,
          null,
          sumRef ? { t: 'formula', f: sumRef.ref, v: sumRef.value, s: 'amBandNum' } : blank('amBand'),
          str(unitText(pos.unit), 'amBandUnit'),
          ...(prices
            ? [pos.unitPrice === null ? blank('amBand') : num(pos.unitPrice, 'amBandMoney'), { t: 'formula', f: `H${bandRow}*F${bandRow}`, v: price, s: 'amBandMoneyBold' } as Cell]
            : []),
        ],
        'amBand',
      );
      if (prices) {
        const sr = sumRows[i];
        merges.push(`A${sr}:B${sr}`, `C${sr}:E${sr}`);
        rows[sr - 1] = fillRow(
          [
            str(pos.number, 'amSumPos'),
            null,
            str(text, 'amSumText'),
            null,
            null,
            sumRef ? { t: 'formula', f: `F${bandRow}`, v: value, s: 'amSumNum' } : blank('amRowBlank'),
            str(unitText(pos.unit), 'amSumUnitC'),
            pos.unitPrice === null ? blank('amRowBlank') : { t: 'formula', f: `H${bandRow}`, v: pos.unitPrice, s: 'amSumMoney' },
            { t: 'formula', f: `I${bandRow}`, v: price, s: 'amSumMoney' },
          ],
          'amRowBlank',
        );
      }
      add([], 10);
    });
    if (prices) {
      merges.push(`A${totalRow}:H${totalRow}`);
      rows[totalRow - 1] = fillRow(
        [str('Gesamtpreis in EUR', 'amTotalLabel'), null, null, null, null, null, null, null, { t: 'formula', f: `SUM(I${sumRows[0]}:I${sumRows[sumRows.length - 1]})`, v: Math.round(total * 100) / 100, s: 'amTotalMoney' }],
        'amTotalBlank',
      );
    }
  }

  /**
   * Messtabelle – in allen Tabellen dieselben Spalten: Plan | Nr. | Länge | Breite | Tiefe | Menge (Kopf = Einheit) |
   * … | Bemerkung. Was zur Tabelle nicht gehört, bleibt leer (Stk./m/l: nur die Menge · m²: Länge, Breite ·
   * m³: Länge, Breite, Tiefe). Spalte „Bemerkung“ nur, wenn es etwas zu bemerken gibt. Liefert die Summenzelle
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
    add(
      fillRow(
        [
          str('Plan', 'amHead'),
          str('Nr.', 'amHead'),
          areaTable ? str('Länge', 'amHeadR') : null,
          areaTable ? str(labels.width ?? 'Breite', 'amHeadR') : null,
          withDepth ? str(labels.depth ?? 'Tiefe', 'amHeadR') : null,
          str(unitHead, 'amHeadR'),
          null,
          notes.some(Boolean) ? str('Bemerkung', 'amHeadL') : null,
        ],
        'amHead',
      ),
      15,
    );
    const first = rows.length + 1;
    let total = 0;
    lines.forEach(({ item, ded }, i) => {
      const { plan, d } = item;
      const r = rows.length + 1;
      const note = notes[i];
      const q = (v: number, f: string): Cell => ({ t: 'formula', f, v, s: ded ? 'amDedQty' : 'amRowQty' });
      const noteCell: Cell = note ? str(note, ded ? 'amDedNote' : 'amRowNote') : null;
      if (ded) {
        // Teilfläche mit Vorzeichen: Abzug negativ, Zuschlag positiv (Anzahl als Faktor)
        const sign = `${ded.add ? '' : '-'}${ded.count > 1 ? `${ded.count}*` : ''}`;
        const a = deductionArea(ded);
        let cells: Cell[];
        if (!areaTable) {
          // Linie: Teillänge mit Vorzeichen (Anzahl × Länge steht in der Bemerkung)
          const v = deductionLength(ded);
          total += v;
          cells = [null, null, null, num(v, 'amDedQty')];
        } else if (kind === 'volume') {
          const v = d.depth !== null ? (a < 0 ? -1 : 1) * round2(Math.abs(a) * d.depth) : null;
          total += v ?? 0;
          cells = [n(ded.length, true), n(ded.width ?? null, true), n(d.depth, true), v === null ? qn(null) : q(v, `${sign}ROUND(ROUND(C${r}*D${r},2)*E${r},2)`)];
        } else {
          total += a;
          cells = [n(ded.length, true), n(ded.width ?? null, true), null, q(a, `${sign}ROUND(C${r}*D${r},2)`)];
        }
        const dNo = deductionNumbers(d)[(d.deductions ?? []).indexOf(ded)] ?? '';
        add(fillRow([null, dNo ? str(dNo, 'amDedCenter') : null, ...cells, null, noteCell], 'amRowBlank'));
        return;
      }
      let cells: Cell[];
      const baseUnit = kind === 'area' || kind === 'areaDepth' ? 'm²' : kind === 'volume' ? 'm³' : kind === 'count' ? 'Stk' : kind === 'length' ? 'm' : null;
      if (item.rebar) {
        // Bewehrungsposition: Länge der Bewehrung, die bei der Schadstelle eingetragen ist
        const qty = d.rebar ?? null;
        total += qty ?? 0;
        add(fillRow([planCell(plan), nrCell(d), null, null, null, qn(qty), null, noteCell], 'amRowBlank'));
        return;
      }
      if (steps(item) && baseUnit) {
        // Zulage: Stufen × Nettomenge der Schadstelle (als Formel, damit man die Stufen sieht)
        const base = quantityFor(baseUnit, [d]).value;
        const v = base === null ? null : Math.round(item.factor! * base * 10000) / 10000;
        total += v ?? 0;
        const qty = v === null ? qn(null) : q(v, `${item.factor}*${base}`);
        cells = areaTable ? [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), withDepth ? dn(d.depth) : null, qty] : [null, null, null, qty];
        add(fillRow([planCell(plan), nrCell(d), ...cells, null, noteCell], 'amRowBlank'));
        return;
      }
      // Bruttofläche (Länge × Breite bzw. aus dem Plan); die Abzüge folgen in eigenen Zeilen
      const g = grossArea(d);
      if (kind === 'area' || kind === 'areaDepth') {
        const v = g ?? 0;
        total += v;
        const formula = d.width !== null && !d.areaFromShape;
        cells = [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), kind === 'areaDepth' ? dn(d.depth) : null, formula ? q(v, `ROUND(C${r}*D${r},2)`) : qn(g)];
      } else if (kind === 'volume') {
        const v = g !== null && d.depth !== null ? round2(g * d.depth) : null;
        total += v ?? 0;
        const formula = d.width !== null && d.depth !== null && !d.areaFromShape;
        cells = [n(d.areaFromShape ? null : d.length), n(d.areaFromShape ? null : d.width), dn(d.depth), formula ? q(v ?? 0, `ROUND(ROUND(C${r}*D${r},2)*E${r},2)`) : qn(v)];
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
      add(fillRow([planCell(plan), nrCell(d), ...cells, null, noteCell], 'amRowBlank'));
    });
    const lastRow = rows.length;
    if (kind === 'other') return null;
    const col = COLS[QTY];
    const value = Math.round(total * 10000) / 10000;
    const sr = add(fillRow([str('Summe', 'amSumLabel'), null, null, null, null, { t: 'formula', f: `SUM(${col}${first}:${col}${lastRow})`, v: value, s: 'amSumQty' }, str(unitHead, 'amSumUnit')], 'amSumBlank'), 16);
    return { ref: `${col}${sr}`, value };
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
    headerCenter: `Aufmaßblatt ${info.no}`,
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
  };
}

/** Liter aus Fläche × Tiefe (1 m³ = 1000 l); ohne Tiefe nicht berechenbar */
function liters(d: Damage): number | null {
  return hasArea(kindOf(d)) && d.area !== null && d.depth !== null ? Math.round(d.area * d.depth * 1000 * 100) / 100 : null;
}

/** Bemerkung einer Abzugs- bzw. Zuschlagszeile, z. B. „Abzug Tür (2×)“ */
function dedNote(x: Deduction, line = false): string {
  const m = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const size = line ? `(${x.count > 1 ? `${x.count} × ` : ''}${m(x.length)} m)` : x.count > 1 ? `(${x.count}×)` : '';
  // Bezeichnung in der Bemerkung (die Nummer steht in der Spalte „Nr.“)
  return [x.label?.trim() || (x.add ? 'Zuschlag' : 'Abzug'), size].filter(Boolean).join(' ');
}

/** Bemerkung: nur Hinweise (Fläche aus dem Plan, fehlende Werte) – sonst leer */
function remark(d: Damage, kind: Kind): string {
  const parts: string[] = [];
  if (d.note?.trim()) parts.push(d.note.trim());
  if (d.areaFromShape) parts.push('Fläche aus Plan');
  if ((kind === 'volume' || kind === 'liter') && d.depth === null) parts.push('ohne Tiefe');
  if (kind === 'area' && d.area === null) parts.push('keine Fläche');
  if (kind === 'other') parts.push('Menge nicht aus Messung ableitbar');
  return parts.join(' · ');
}
