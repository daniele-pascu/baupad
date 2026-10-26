import { KIND_LABELS, kindOf, quantityBasis, quantityFor, sumAreas, sumLengths } from './measure';
import { naturalCompare } from './numbers';
import type { ProjectState } from './store';
import { alive } from './store';
import type { Component, CostCenter, Damage, DrawElement, LvDocument, LvPosition, Plan } from './types';
import { blank, buildXlsx, colName, num, sheetName, str, type Cell, type HeaderImage, type Sheet } from './xlsx';

/** Pläne einer Kostenstelle, sortiert nach Plannummer. */
export function plansOf(data: ProjectState, costCenterId: string): Plan[] {
  return alive(data.plans)
    .filter((p) => p.costCenterId === costCenterId)
    .sort((a, b) => naturalCompare(a.planNumber, b.planNumber) || a.sortIndex - b.sortIndex);
}

/** Schadstellen eines Plans, sortiert nach Nummer. */
export function damagesOf(data: ProjectState, planId: string): Damage[] {
  return alive(data.damages)
    .filter((d) => d.planId === planId)
    .sort((a, b) => a.number - b.number || a.createdAt - b.createdAt);
}

/** Bauteilkennzeichnungen eines Plans, sortiert nach Buchstabe. */
export function componentsOf(data: ProjectState, planId: string): Component[] {
  return alive(data.components ?? {})
    .filter((c) => c.planId === planId)
    .sort((a, b) => naturalCompare(a.letter, b.letter));
}

/** Zeichnungsobjekte eines selbst gezeichneten Plans in Zeichenreihenfolge. */
export function elementsOf(data: ProjectState, planId: string): DrawElement[] {
  return alive(data.elements ?? {})
    .filter((e) => e.planId === planId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** LV und MFK des Projekts: zuerst LV, dann MFK nach Nummer. */
export function lvDocsOf(data: ProjectState): LvDocument[] {
  return alive(data.lvDocs ?? {}).sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'lv' ? -1 : 1) || naturalCompare(a.number, b.number) || a.createdAt - b.createdAt,
  );
}

export const lvDocLabel = (d: Pick<LvDocument, 'kind' | 'name' | 'number'>) =>
  [d.kind === 'lv' ? 'LV' : 'MFK', d.number, d.name ? `– ${d.name}` : ''].filter(Boolean).join(' ');

export const positionRef = (docId: string, posId: string) => `${docId}:${posId}`;

/** Position zu einem Verweis „Dokument:Position“ (null, wenn gelöscht). */
export function findPosition(data: ProjectState, ref: string | null | undefined): { doc: LvDocument; pos: LvPosition } | null {
  if (!ref) return null;
  const [docId, posId] = ref.split(':');
  const doc = data.lvDocs?.[docId];
  if (!doc || doc.deletedAt) return null;
  const pos = doc.positions.find((p) => p.id === posId);
  return pos ? { doc, pos } : null;
}

/** Alle Messungen des Projekts, die einer Position zugeordnet sind. */
export function damagesForPosition(data: ProjectState, ref: string): Damage[] {
  const livePlans = new Set(alive(data.plans).map((p) => p.id));
  return alive(data.damages).filter((d) => d.positionRef === ref && livePlans.has(d.planId));
}

/** Zugeordnete Positionen eines Plans (eindeutig, nach Positionsnummer). */
export function positionsOfPlan(data: ProjectState, planId: string): { doc: LvDocument; pos: LvPosition }[] {
  const refs = new Set(damagesOf(data, planId).map((d) => d.positionRef).filter(Boolean) as string[]);
  return [...refs]
    .map((r) => findPosition(data, r))
    .filter((x): x is { doc: LvDocument; pos: LvPosition } => !!x)
    .sort((a, b) => naturalCompare(a.pos.number, b.pos.number));
}

export function costCentersOf(data: ProjectState): CostCenter[] {
  return alive(data.costCenters).sort((a, b) => a.sortIndex - b.sortIndex || naturalCompare(a.name, b.name));
}

/**
 * Anzeige einer Kostenstelle: „4711 – Tiefgarage“, nur Nummer oder nur Bezeichnung.
 * Leer bei einem Projekt ohne Kostenstelle (die Pläne liegen dann in einer leeren Kostenstelle).
 */
export function costCenterLabel(cc: Pick<CostCenter, 'number' | 'name'> | undefined): string {
  if (!cc) return '';
  return [cc.number?.trim(), cc.name.trim()].filter(Boolean).join(' – ');
}

/** Wie costCenterLabel, für Überschriften und Auswahllisten mit Ersatztext */
export const costCenterName = (cc: Pick<CostCenter, 'number' | 'name'> | undefined) => costCenterLabel(cc) || 'Ohne Kostenstelle';

export function planTitle(p: Plan): string {
  return [p.planNumber, p.planName].filter(Boolean).join(' – ') || 'Plan ohne Bezeichnung';
}

/** Flächensumme (m²) – Linienmessungen zählen nicht mit. */
export function sumArea(damages: Damage[]): number {
  return sumAreas(damages);
}

export interface AufmassRow {
  plan: Plan;
  damage: Damage;
}

/** Aufmaßzeilen sortiert nach Plan (Plannummer) und Schadstellennummer. */
export function aufmassRows(data: ProjectState, plans: Plan[]): AufmassRow[] {
  const sorted = [...plans].sort((a, b) => naturalCompare(a.planNumber, b.planNumber) || a.sortIndex - b.sortIndex);
  return sorted.flatMap((plan) => damagesOf(data, plan.id).map((damage) => ({ plan, damage })));
}

export const XLSX_HEADERS = ['Plannummer', 'Schadstellennummer', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)'];

/** Tabellenblatt mit genau den Spalten A–F und einer Summenzeile. */
export function aufmassSheet(name: string, rows: AufmassRow[]): Omit<Sheet, 'name'> & { name: string } {
  const header: Cell[] = XLSX_HEADERS.map((h) => str(h, 'header'));
  const body: Cell[][] = rows.map(({ plan, damage }) => [
    str(plan.planNumber || plan.planName || ''),
    (damage.label ? str(damage.label) : num(damage.number, 'int')),
    num(damage.length, 'measure'),
    // Leere Werte bleiben leere Zellen (keine 0): Linien haben keine Breite/Fläche, Tiefe ist optional
    damage.width === null ? null : num(damage.width, 'measure'),
    damage.depth === null ? null : num(damage.depth, 'measure'),
    damage.area === null ? null : num(damage.area, 'area'),
  ]);
  const last = rows.length + 1;
  const total = sumArea(rows.map((r) => r.damage));
  const sumRow: Cell[] = [
    str('Summe', 'boldText'),
    null,
    null,
    null,
    null,
    rows.length ? { t: 'formula', f: `SUM(F2:F${last})`, v: total, s: 'boldArea' } : num(0, 'boldArea'),
  ];
  return {
    name,
    rows: [header, ...body, [], sumRow],
    widths: [16, 20, 12, 12, 12, 14],
    freezeHeader: true,
    autoFilter: `A1:F${Math.max(2, last)}`,
  };
}

function infoSheet(data: ProjectState, costCenters: CostCenter[], plans: Plan[], used: Set<string>): Sheet {
  const p = data.project;
  const rows: Cell[][] = [
    [str('BauPad – Aufmaß', 'title')],
    [],
    [str('Projekt', 'label'), str(p.name)],
    // Reihenfolge wie in den Projektinformationen; Baubeginn erscheint nur dort (nicht im Export)
    [str('Kostenstelle(n)', 'label'), str(costCenters.map((c) => costCenterLabel(c)).filter(Boolean).join(', '))],
    [str('Projektnummer', 'label'), str(p.number ?? '')],
    [str('Adresse', 'label'), str(p.address)],
    [str('Auftraggeber', 'label'), str(p.client)],
    // ältere Angaben (Felder werden nicht mehr erfasst) nur, wenn vorhanden
    ...(p.site ? [[str('Baustelle', 'label'), str(p.site)]] : []),
    ...(p.editor ? [[str('Bearbeiter', 'label'), str(p.editor)]] : []),
    [str('Exportiert am', 'label'), str(new Date().toLocaleString('de-DE'))],
    [],
    ['Kostenstelle', 'Plannummer', 'Planname', 'Geschoss', 'Planbereich', 'Originaldatei', 'Seite', 'Anzahl Schadstellen', 'Fläche gesamt (m²)'].map(
      (h) => str(h, 'header'),
    ),
  ];
  for (const cc of costCenters) {
    for (const plan of plans.filter((x) => x.costCenterId === cc.id)) {
      const damages = damagesOf(data, plan.id);
      rows.push([
        str(costCenterLabel(cc)),
        str(plan.planNumber),
        str(plan.planName),
        str(plan.floor),
        str(plan.area),
        str(plan.source === 'drawing' ? 'selbst gezeichnet' : (data.files[plan.fileId]?.name ?? '')),
        plan.source === 'drawing' ? null : num(plan.pageIndex + 1, 'int'),
        num(damages.length, 'int'),
        num(sumArea(damages), 'area'),
      ]);
    }
  }
  return { name: sheetName('Projektdaten', used), rows, widths: [22, 16, 28, 14, 18, 28, 8, 12, 14], landscape: true, print: true };
}

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

/**
 * Dateiname aus mehreren Teilen. Umlaute werden umschrieben und sonstige Sonderzeichen
 * entfernt, da manche Browser und Geräte nicht-ASCII-Dateinamen beim Download verwerfen.
 */
export function safeFileName(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/[äöüÄÖÜß]/g, (c) => TRANSLIT[c])
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[._-]+|[._-]+$/g, ''),
    )
    .filter(Boolean)
    .join('_');
}

export interface ExportFile {
  name: string;
  data: Uint8Array;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type XlsxScope = { kind: 'plan'; planId: string } | { kind: 'costCenter'; costCenterId: string } | { kind: 'project' };

/** 'positions': zusätzlicher Export, nach LV/MFK-Positionen gruppiert */
export type XlsxLayout = 'standard' | 'classic' | 'positions';

/**
 * Excel-Export.
 * - 'standard' (Neu, Standard): je Plan ein druckfertiges Blatt (A1 = Plan, Zeile 2 = Überschriften),
 *   dazu Übersicht, LV/MFK-Auswertung und nicht zugeordnete Messungen.
 * - 'classic': bisheriger Export – eine Tabelle je Kostenstelle mit Plannummer in Spalte A.
 */
export function exportXlsx(data: ProjectState, scope: XlsxScope, layout: XlsxLayout = 'standard', opts: XlsxOptions = {}): ExportFile {
  const out: BuildOut = (sheets) =>
    buildXlsx(
      sheets.map((sh) => (sh.print && !sh.headerLeft ? { ...sh, headerLeft: headerLeftFor(data, scope) } : sh)),
      { logo: opts.logo },
    );
  return layout === 'positions' ? exportByPositions(data, scope, out) : layout === 'classic' ? exportClassic(data, scope, out) : exportStandard(data, scope, out);
}

/** Arbeitsmappe bauen (mit Kopfzeile und Firmenlogo) */
type BuildOut = (sheets: Sheet[]) => Uint8Array;

/** Firmenlogo (Kopfzeile rechts) für alle Excel-Exporte */
export interface XlsxOptions {
  logo?: HeaderImage | null;
}

/** Untertitel des Aufmaßblatts: Projekt · Kostenstelle · Plan · Stand */
function aufmassSubtitle(data: ProjectState, scope: XlsxScope): string {
  const plan = scope.kind === 'plan' ? data.plans[scope.planId] : undefined;
  return [headerLeftFor(data, scope).replace(' / ', ' · '), plan ? `Plan ${planTitle(plan)}` : '', `Stand ${new Date().toLocaleDateString('de-DE')}`].filter(Boolean).join(' · ');
}

/** Kopfzeile links: Projektname / Kostenstelle (bzw. nur Projekt bei Gesamtexport) */
function headerLeftFor(data: ProjectState, scope: XlsxScope): string {
  const cc =
    scope.kind === 'plan' ? data.costCenters[data.plans[scope.planId]?.costCenterId] : scope.kind === 'costCenter' ? data.costCenters[scope.costCenterId] : undefined;
  return [data.project.name, costCenterLabel(cc)].filter(Boolean).join(' / ');
}

function exportClassic(data: ProjectState, scope: XlsxScope, out: BuildOut): ExportFile {
  const used = new Set<string>();
  const ccs = costCentersOf(data);
  if (scope.kind === 'plan') {
    const plan = data.plans[scope.planId];
    const cc = data.costCenters[plan.costCenterId];
    const sheet = aufmassSheet(sheetName(plan.planNumber || 'Aufmaß', used), aufmassRows(data, [plan]));
    return {
      name: `${safeFileName(data.project.name, costCenterLabel(cc), plan.planNumber || plan.planName, 'Aufmass')}.xlsx`,
      data: out([sheet, infoSheet(data, cc ? [cc] : [], [plan], used)]),
      mimeType: XLSX_MIME,
    };
  }
  if (scope.kind === 'costCenter') {
    const cc = data.costCenters[scope.costCenterId];
    const plans = plansOf(data, cc.id);
    const sheet = aufmassSheet(sheetName(costCenterLabel(cc) || 'Aufmaß', used), aufmassRows(data, plans));
    return {
      name: `${safeFileName(data.project.name, costCenterLabel(cc), 'Aufmass')}.xlsx`,
      data: out([sheet, infoSheet(data, [cc], plans, used)]),
      mimeType: XLSX_MIME,
    };
  }
  // Gesamtprojekt: ein Tabellenblatt je Kostenstelle
  const sheets: Sheet[] = [];
  const allPlans: Plan[] = [];
  for (const cc of ccs) {
    const plans = plansOf(data, cc.id);
    allPlans.push(...plans);
    sheets.push(aufmassSheet(sheetName(costCenterLabel(cc) || 'Aufmaß', used), aufmassRows(data, plans)));
  }
  if (!sheets.length) sheets.push(aufmassSheet(sheetName('Aufmaß', used), []));
  sheets.push(infoSheet(data, ccs, allPlans, used));
  return {
    name: `${safeFileName(data.project.name, 'Aufmass')}.xlsx`,
    data: out(sheets),
    mimeType: XLSX_MIME,
  };
}

// ---------------------------------------------------------------------------
// Excel (Standard): Übersicht · Aufmaß nach Leistungen · Messliste · LV-Abgleich

/** Ein Block des Aufmaßblatts (für die Zusammenfassung in der Übersicht) */
export interface BlockInfo {
  /** Positionsnummer ('' = ohne Leistung) */
  pos: string;
  text: string;
  unit: string;
  /** Zelle der Summe im Blatt „Aufmaß“, z. B. „E8“ */
  sumRef: string;
  total: number;
  price: number | null;
  count: number;
}

const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
const blankRow = (n: number, s: Parameters<typeof blank>[0]) => Array.from({ length: n }, () => blank(s));
/** Abschnittsüberschrift als Band über n Spalten */
const section = (title: string, n: number): Cell[] => [str(title, 'blockTitle'), ...blankRow(n - 1, 'blockTitle')];

/** Einheit für die Anzeige (m2 → m², m3 → m³) */
const unitLabel = (u: string) => u.replace(/^m2$/i, 'm²').replace(/^m3$/i, 'm³').replace(/^qm$/i, 'm²').replace(/^cbm$/i, 'm³');

/**
 * Aufmaßblatt im Layout der BauPad-Vorlage, druckfertig auf einer Seite:
 * Titel mit Projekt/Kostenstelle, dann je Leistung ein Block – Kurztext mit Positionsnummer,
 * lückenlose Tabelle (Plan, Nr., Länge und nur vorhandene Breite/Tiefe, Menge), Summe, und
 * bei Positionen Einheitspreis und Gesamtpreis (Formeln). Messungen ohne Leistung folgen getrennt
 * nach Flächen und Linien.
 */
export function aufmassBlocksSheet(data: ProjectState, plans: Plan[], used: Set<string>, subtitle = '', collect?: BlockInfo[]): Sheet {
  const items = aufmassRows(data, plans).map(({ plan, damage }) => ({ plan, d: damage }));
  const rows: Cell[][] = [[str('Aufmaß nach Leistungen', 'title')], [str(subtitle || data.project.name, 'subtitle')], []];
  const totals: string[] = [];
  let money = 0;
  let maxCols = 4;
  const pushBlock = (
    title: string,
    unit: string,
    list: { plan: Plan; d: Damage; q: number | null }[],
    price: number | null,
    priced: boolean,
    info: Pick<BlockInfo, 'pos' | 'text'>,
  ) => {
    // nur Spalten mit Werten – keine leeren Kästen
    const showW = list.some((x) => x.d.width !== null);
    const showT = list.some((x) => x.d.depth !== null);
    const u = unitLabel(unit);
    const head = ['Plan', 'Nr.', 'Länge (m)', ...(showW ? ['Breite (m)'] : []), ...(showT ? ['Tiefe (m)'] : []), `Menge (${u})`];
    const n = head.length;
    maxCols = Math.max(maxCols, n);
    const q = colName(n - 1);
    const isCount = /^(st|stk|stück|psch)/i.test(unit);
    // Volumen: kleine Mengen mit bis zu 3 Nachkommastellen (0,036 m³ statt 0,04)
    const fine = u === 'm³';
    rows.push([str(title, 'blockTitle'), ...Array.from({ length: n - 1 }, () => blank('blockTitle'))]);
    rows.push(head.map((h) => str(h, 'gridHead')));
    const first = rows.length + 1;
    for (const { plan, d, q: v } of list) {
      rows.push([
        str(plan.planNumber || plan.planName, 'gridText'),
        d.label ? str(d.label, 'gridText') : num(d.number, 'gridInt'),
        num(d.length, 'gridMeasure'),
        ...(showW ? [d.width === null ? blank('gridMeasure') : num(d.width, 'gridMeasure')] : []),
        ...(showT ? [d.depth === null ? blank('gridMeasure') : num(d.depth, 'gridMeasure')] : []),
        v === null ? blank('gridArea') : num(v, isCount ? 'gridInt' : fine ? 'gridMeasure' : 'gridArea'),
      ]);
    }
    const last = rows.length;
    const total = Math.round(list.reduce((a, x) => a + (x.q ?? 0), 0) * 10000) / 10000;
    const sumRow: Cell[] = Array.from({ length: n }, () => null);
    sumRow[n - 2] = str(`Summe ${u}`, 'sumLabel');
    sumRow[n - 1] = { t: 'formula', f: `SUM(${q}${first}:${q}${last})`, v: total, s: fine ? 'sumMeasure' : 'sumValue' };
    rows.push(sumRow);
    const sumRef = `${q}${rows.length}`;
    collect?.push({ ...info, unit: u, sumRef, total, price, count: list.length });
    if (priced) {
      const ep: Cell[] = Array.from({ length: n }, () => null);
      ep[n - 2] = str(`Einheitspreis (€/${u})`, 'kvLabel');
      ep[n - 1] = price === null ? blank('kvMoney') : num(price, 'kvMoney');
      rows.push(ep);
      const epRef = `${q}${rows.length}`;
      const gp: Cell[] = Array.from({ length: n }, () => null);
      const amount = price !== null ? Math.round(total * price * 100) / 100 : 0;
      gp[n - 2] = str('Summe gesamte Leistung', 'sumLabel');
      gp[n - 1] = { t: 'formula', f: `${sumRef}*${epRef}`, v: amount, s: 'kvMoneyBold' };
      rows.push(gp);
      totals.push(`${q}${rows.length}`);
      money += amount;
    }
    rows.push([]);
  };

  // Leistungen in LV-Reihenfolge, nur mit zugeordneten Messungen; Titel = Pos.-Nr. und Kurztext
  for (const doc of lvDocsOf(data)) {
    for (const p of doc.positions) {
      const own = items.filter((x) => x.d.positionRef === positionRef(doc.id, p.id));
      if (!own.length) continue;
      pushBlock(
        [`Pos. ${p.number}`, p.shortText].filter(Boolean).join('  '),
        p.unit || 'EH',
        own.map((x) => ({ ...x, q: measurementQuantity(p.unit, x.d).value })),
        p.unitPrice,
        true,
        { pos: p.number, text: p.shortText || `Position ${p.number}` },
      );
    }
  }
  // Ohne Leistung: Flächen (m²) und Linien (m) getrennt – nie zusammengezählt
  const free = items.filter((x) => !findPosition(data, x.d.positionRef));
  const freeLines = free.filter((x) => kindOf(x.d) === 'line');
  const freeAreas = free.filter((x) => kindOf(x.d) !== 'line');
  const withoutPos = free.length < items.length;
  const areaTitle = withoutPos ? 'Flächen ohne Leistung' : 'Flächen';
  const lineTitle = withoutPos ? 'Linien ohne Leistung' : 'Linien';
  if (freeAreas.length) pushBlock(areaTitle, 'm²', freeAreas.map((x) => ({ ...x, q: x.d.area })), null, false, { pos: '', text: areaTitle });
  if (freeLines.length) pushBlock(lineTitle, 'm', freeLines.map((x) => ({ ...x, q: x.d.length })), null, false, { pos: '', text: lineTitle });
  if (!items.length) rows.push([str('Noch keine Messungen erfasst.', 'note')]);
  if (totals.length > 1) {
    const r: Cell[] = Array.from({ length: maxCols }, () => null);
    r[maxCols - 2] = str('Summe aller Leistungen', 'sumLabel');
    r[maxCols - 1] = { t: 'formula', f: totals.join('+'), v: Math.round(money * 100) / 100, s: 'kvMoneyBold' };
    rows.push(r);
  }
  // Spalten: Plan, Nr., Länge, (Breite), (Tiefe), Menge – schmal genug für A4 hoch
  return {
    name: sheetName('Aufmaß', used),
    rows,
    widths: [11, 7, 11, 11, 11, 14].slice(0, Math.max(maxCols, 4)),
    print: true,
    pageLayout: true,
    onePage: true,
  };
}


/**
 * Übersicht (erstes Blatt): Projektdaten, Zusammenfassung je Leistung (Mengen per Formel aus dem
 * Blatt „Aufmaß“, Einheits- und Gesamtpreise, Summe netto) und die exportierten Pläne.
 */
function summarySheet(data: ProjectState, plans: Plan[], ccList: CostCenter[], blocks: BlockInfo[], aufmassName: string, used: Set<string>, subtitle: string, planScope: Plan | null): Sheet {
  const p = data.project;
  const all = plans.flatMap((pl) => damagesOf(data, pl.id));
  const rows: Cell[][] = [[str('Aufmaß', 'title')], [str(subtitle, 'subtitle')], [], section('Projektdaten', 6)];
  const info: [string, string][] = [
    ['Projekt', p.name],
    ['Projektnummer', p.number ?? ''],
    ['Auftraggeber', p.client],
    ['Adresse', p.address],
    ['Kostenstelle', ccList.map((c) => costCenterLabel(c)).filter(Boolean).join(', ')],
    ...(planScope ? ([['Plan', planTitle(planScope)]] as [string, string][]) : []),
    ['Umfang', `${plans.length} ${plans.length === 1 ? 'Plan' : 'Pläne'} · ${all.length} ${all.length === 1 ? 'Messung' : 'Messungen'}`],
    ['Stand', new Date().toLocaleDateString('de-DE')],
  ];
  for (const [k, v] of info.filter(([, v]) => v)) rows.push([str(k, 'label'), str(v, 'plain')]);
  rows.push([]);

  // Zusammenfassung je Leistung
  rows.push(section('Zusammenfassung', 6));
  rows.push(['Pos.', 'Leistung', 'Einheit', 'Menge', 'EP (€)', 'GP (€)'].map((h) => str(h, 'gridHead')));
  const first = rows.length + 1;
  let money = 0;
  let priced = false;
  for (const b of blocks) {
    const r = rows.length + 1;
    const amount = b.price !== null ? Math.round(b.total * b.price * 100) / 100 : null;
    if (amount !== null) {
      money += amount;
      priced = true;
    }
    rows.push([
      str(b.pos || '–', 'gridText'),
      str(b.text, 'gridLeft'),
      str(b.unit, 'gridText'),
      { t: 'formula', f: `${quoted(aufmassName)}!${b.sumRef}`, v: b.total, s: b.unit === 'm³' ? 'gridMeasure' : 'gridArea' },
      b.price === null ? blank('gridMoney') : num(b.price, 'gridMoney'),
      amount === null ? blank('gridMoney') : { t: 'formula', f: `D${r}*E${r}`, v: amount, s: 'gridMoney' },
    ]);
  }
  if (!blocks.length) rows.push([str('–', 'gridText'), str('Noch keine Messungen erfasst.', 'gridNote'), ...blankRow(4, 'gridText')]);
  const last = rows.length;
  if (priced) rows.push([null, null, null, null, str('Summe netto', 'sumLabel'), { t: 'formula', f: `SUM(F${first}:F${last})`, v: Math.round(money * 100) / 100, s: 'kvMoneyBold' }]);
  rows.push([]);

  // Pläne
  rows.push(section('Pläne', 6));
  rows.push(['Plan', 'Bezeichnung', 'Ebene', 'Messungen', 'Fläche (m²)', 'Linien (m)'].map((h) => str(h, 'gridHead')));
  const pFirst = rows.length + 1;
  for (const pl of plans) {
    const ds = damagesOf(data, pl.id);
    rows.push([
      str(pl.planNumber, 'gridText'),
      str(pl.planName, 'gridLeft'),
      str(pl.floor, 'gridText'),
      num(ds.length, 'gridInt'),
      num(sumAreas(ds), 'gridArea'),
      num(sumLengths(ds), 'gridArea'),
    ]);
  }
  const pLast = rows.length;
  if (plans.length > 1)
    rows.push([
      null,
      null,
      str('Summe', 'sumLabel'),
      { t: 'formula', f: `SUM(D${pFirst}:D${pLast})`, v: all.length, s: 'sumValue' },
      { t: 'formula', f: `SUM(E${pFirst}:E${pLast})`, v: sumAreas(all), s: 'sumValue' },
      { t: 'formula', f: `SUM(F${pFirst}:F${pLast})`, v: sumLengths(all), s: 'sumValue' },
    ]);
  rows.push([]);
  rows.push([str('Mengen aus dem Blatt „Aufmaß“ · alle Messungen einzeln im Blatt „Messliste“ · Beträge netto.', 'subtitle')]);
  return { name: sheetName('Übersicht', used), rows, widths: [16, 38, 10, 12, 12, 14], print: true, pageLayout: true };
}

/** Messliste: alle Messungen in einer filterbaren Tabelle; Summen berücksichtigen den Filter */
function measureListSheet(data: ProjectState, plans: Plan[], used: Set<string>, subtitle: string): Sheet {
  const items = aufmassRows(data, plans);
  const head = ['Plan', 'Nr.', 'Messart', 'Pos.', 'Leistung', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)', 'Volumen (m³)'];
  const rows: Cell[][] = [[str('Messliste', 'title')], [str(subtitle, 'subtitle')], head.map((h) => str(h, 'gridHead'))];
  const first = rows.length + 1;
  let area = 0;
  let vol = 0;
  for (const { plan, damage: d } of items) {
    const pos = findPosition(data, d.positionRef)?.pos;
    const v = d.area !== null && d.depth !== null && kindOf(d) !== 'line' ? Math.round(d.area * d.depth * 10000) / 10000 : null;
    if (d.area !== null && kindOf(d) !== 'line') area += d.area;
    if (v !== null) vol += v;
    rows.push([
      str(plan.planNumber || plan.planName, 'gridText'),
      d.label ? str(d.label, 'gridText') : num(d.number, 'gridInt'),
      str(KIND_LABELS[kindOf(d)], 'gridText'),
      str(pos?.number ?? '', 'gridText'),
      str(pos?.shortText ?? '', 'gridLeft'),
      num(d.length, 'gridMeasure'),
      d.width === null ? blank('gridMeasure') : num(d.width, 'gridMeasure'),
      d.depth === null ? blank('gridMeasure') : num(d.depth, 'gridMeasure'),
      d.area === null || kindOf(d) === 'line' ? blank('gridArea') : num(d.area, 'gridArea'),
      v === null ? blank('gridMeasure') : num(v, 'gridMeasure'),
    ]);
  }
  const last = Math.max(first, rows.length);
  if (!items.length) rows.push([str('Noch keine Messungen erfasst.', 'note')]);
  rows.push([
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    str('Summe', 'sumLabel'),
    { t: 'formula', f: `SUBTOTAL(109,I${first}:I${last})`, v: Math.round(area * 10000) / 10000, s: 'sumValue' },
    { t: 'formula', f: `SUBTOTAL(109,J${first}:J${last})`, v: Math.round(vol * 10000) / 10000, s: 'sumMeasure' },
  ]);
  rows.push([str('Tipp: Über die Pfeile in der Kopfzeile filtern und sortieren (z. B. nach Plan oder Leistung) – die Summen passen sich an.', 'subtitle')]);
  return {
    name: sheetName('Messliste', used),
    rows,
    widths: [10, 7, 12, 10, 30, 11, 11, 10, 12, 13],
    headerRows: 3,
    autoFilter: `A3:J${last}`,
    landscape: true,
    print: true,
  };
}

/**
 * LV-Abgleich je LV/MFK: LV-Menge und Aufmaßmenge getrennt, Differenz und Beträge nur bei
 * vorhandenen Werten und passender Einheit (nichts wird erfunden).
 */
function lvSheet(doc: LvDocument, damages: Damage[], used: Set<string>, subtitle: string): Sheet {
  const headers = ['Pos.', 'Kurztext', 'EH', 'LV-Menge', 'Aufmaß-Menge', 'Differenz', 'EP (€)', 'GP LV (€)', 'GP Aufmaß (€)', 'Hinweis'];
  const rows: Cell[][] = [[str(`LV-Abgleich – ${lvDocLabel(doc)}`, 'title')], [str(subtitle, 'subtitle')], headers.map((h) => str(h, 'gridHead'))];
  const first = rows.length + 1;
  let lvSum = 0;
  let measuredSum = 0;
  const add = (a: number, b: number) => ((lvSum += a), (measuredSum += b));
  for (const g of doc.groups.filter((x) => x.number.split(' ').length <= 2)) {
    const positions = doc.positions.filter((p) => p.group === g.number);
    if (!positions.length) continue;
    rows.push([str(g.number, 'blockTitle'), str(g.title, 'blockTitle'), ...blankRow(8, 'blockTitle')]);
    for (const p of positions) rows.push(lvRow(doc, p, damages, rows.length + 1, add));
  }
  for (const p of doc.positions.filter((x) => !doc.groups.some((g) => g.number === x.group && x.group.split(' ').length <= 2)))
    rows.push(lvRow(doc, p, damages, rows.length + 1, add));
  const last = Math.max(first, rows.length);
  rows.push([
    null,
    null,
    null,
    null,
    null,
    null,
    str('Summe', 'sumLabel'),
    { t: 'formula', f: `SUM(H${first}:H${last})`, v: Math.round(lvSum * 100) / 100, s: 'kvMoneyBold' },
    { t: 'formula', f: `SUM(I${first}:I${last})`, v: Math.round(measuredSum * 100) / 100, s: 'kvMoneyBold' },
  ]);
  rows.push([str('Beträge netto; Aufmaß-Mengen aus den zugeordneten Messungen, LV-Mengen unverändert.', 'subtitle')]);
  return {
    name: sheetName(`${doc.kind === 'lv' ? 'LV' : 'MFK'} ${doc.number || doc.name}`, used),
    rows,
    widths: [12, 40, 6, 11, 13, 11, 11, 13, 14, 28],
    headerRows: 3,
    landscape: true,
    print: true,
  };
}

function lvRow(doc: LvDocument, p: LvPosition, damages: Damage[], row: number, add: (lv: number, measured: number) => void): Cell[] {
  const assigned = damages.filter((d) => d.positionRef === positionRef(doc.id, p.id));
  const q = assigned.length ? quantityFor(p.unit, assigned) : { value: null, missing: 0 };
  const notes: string[] = [];
  if (assigned.length && !quantityBasis(p.unit)) notes.push(`Einheit „${p.unit}“ nicht aus Messungen ableitbar (${assigned.length} Messung(en))`);
  if (q.missing) notes.push(`${q.missing} Messung(en) passen nicht zur Einheit`);
  if (p.issues.length) notes.push(`Import ungeprüft: ${p.issues.join(', ')}`);
  const measuredAmount = q.value !== null && p.unitPrice !== null ? Math.round(q.value * p.unitPrice * 100) / 100 : null;
  add(p.totalPrice ?? 0, measuredAmount ?? 0);
  return [
    str(p.number, 'gridText'),
    str(p.shortText, 'gridLeft'),
    str(unitLabel(p.unit), 'gridText'),
    p.quantity === null ? blank('gridMeasure') : num(p.quantity, 'gridMeasure'),
    q.value === null ? blank('gridMeasure') : num(q.value, 'gridMeasure'),
    p.quantity !== null && q.value !== null ? { t: 'formula', f: `E${row}-D${row}`, v: q.value - p.quantity, s: 'gridMeasure' } : blank('gridMeasure'),
    p.unitPrice === null ? blank('gridMoney') : num(p.unitPrice, 'gridMoney'),
    p.totalPrice === null ? blank('gridMoney') : num(p.totalPrice, 'gridMoney'),
    measuredAmount === null ? blank('gridMoney') : { t: 'formula', f: `E${row}*G${row}`, v: measuredAmount, s: 'gridMoney' },
    str(notes.join('; '), 'gridNote'),
  ];
}

function exportStandard(data: ProjectState, scope: XlsxScope, out: BuildOut): ExportFile {
  const used = new Set<string>();
  const ccs = costCentersOf(data);
  let plans: Plan[];
  let ccList: CostCenter[];
  let name: string;
  if (scope.kind === 'plan') {
    const plan = data.plans[scope.planId];
    const cc = data.costCenters[plan.costCenterId];
    plans = [plan];
    ccList = cc ? [cc] : [];
    name = safeFileName(data.project.name, costCenterLabel(cc), plan.planNumber || plan.planName, 'Aufmass');
  } else if (scope.kind === 'costCenter') {
    const cc = data.costCenters[scope.costCenterId];
    plans = plansOf(data, cc.id);
    ccList = [cc];
    name = safeFileName(data.project.name, costCenterLabel(cc), 'Aufmass');
  } else {
    plans = ccs.flatMap((cc) => plansOf(data, cc.id));
    ccList = ccs;
    name = safeFileName(data.project.name, 'Aufmass');
  }
  const subtitle = aufmassSubtitle(data, scope);
  // Reihenfolge der Blätter: Übersicht, Aufmaß, Messliste, LV-Abgleich (Namen vorab reservieren)
  const overviewUsed = new Set<string>(['übersicht']);
  const blocks: BlockInfo[] = [];
  const aufmass = aufmassBlocksSheet(data, plans, overviewUsed, subtitle, blocks);
  const sheets: Sheet[] = [summarySheet(data, plans, ccList, blocks, aufmass.name, used, subtitle, scope.kind === 'plan' ? plans[0] : null)];
  overviewUsed.forEach((n) => used.add(n));
  sheets.push(aufmass, measureListSheet(data, plans, used, subtitle));
  if (scope.kind !== 'plan') {
    const damages = plans.flatMap((p) => damagesOf(data, p.id));
    for (const doc of lvDocsOf(data)) sheets.push(lvSheet(doc, damages, used, subtitle));
  }
  return { name: `${name}.xlsx`, data: out(sheets), mimeType: XLSX_MIME };
}

// ---------------------------------------------------------------------------
// Excel nach Leistungen: je LV/MFK-Position ein Blatt, dazu freie Messungen

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** Menge einer einzelnen Messung in der Einheit der Position (null = passt nicht/nicht ableitbar) */
function measurementQuantity(unit: string, d: Damage): { value: number | null; note: string } {
  const basis = quantityBasis(unit);
  if (!basis) return { value: null, note: '' };
  const q = quantityFor(unit, [d]);
  if (q.value !== null && !q.missing) return { value: q.value, note: '' };
  if (basis === 'volume') return { value: null, note: hasAreaKind(d) ? 'ohne Tiefe – nicht in m³ berechenbar' : 'Linie – kein Volumen' };
  return { value: null, note: `${KIND_LABELS[kindOf(d)]} – keine Fläche` };
}
const hasAreaKind = (d: Damage) => kindOf(d) !== 'line' && d.area !== null;

const measureCols = (d: Damage): Cell[] => [
  num(d.length, 'measure'),
  d.width === null ? blank() : num(d.width, 'measure'),
  d.depth === null ? blank() : num(d.depth, 'measure'),
];

/** Blatt einer Position: Kopf mit LV-Angaben, je Messung eine Zeile, Summe und Betrag als Formeln. */
function positionSheet(doc: LvDocument, p: LvPosition, items: { plan: Plan; d: Damage }[], used: Set<string>) {
  const basis = quantityBasis(p.unit);
  const unit = p.unit || 'EH';
  const style = basis === 'count' ? 'int' : 'measure';
  const first = 5;
  const body: Cell[][] = items.map(({ plan, d }) => {
    const q = measurementQuantity(p.unit, d);
    return [
      str(plan.planNumber || plan.planName),
      d.label ? str(d.label) : num(d.number, 'int'),
      str(KIND_LABELS[kindOf(d)]),
      ...measureCols(d),
      q.value === null ? blank() : num(q.value, style),
      str(q.note, 'note'),
    ];
  });
  const last = Math.max(first, first + items.length - 1);
  const total = basis ? quantityFor(p.unit, items.map((x) => x.d)).value : null;
  const sumRow = first + items.length + 1;
  const amount = total !== null && p.unitPrice !== null ? Math.round(total * p.unitPrice * 100) / 100 : null;
  const footer: Cell[][] = [
    [str(`Summe Menge (${unit})`, 'label'), null, null, null, null, null, total === null ? blank() : { t: 'formula', f: `SUM(G${first}:G${last})`, v: total, s: 'boldArea' }],
  ];
  if (p.unitPrice !== null) footer.push([str('EP (€)', 'label'), null, null, null, null, null, num(p.unitPrice, 'money')]);
  if (amount !== null) footer.push([str('Betrag (€)', 'label'), null, null, null, null, null, { t: 'formula', f: `G${sumRow}*G${sumRow + 1}`, v: amount, s: 'boldMoney' }]);
  if (!basis) footer.push([str(`Einheit „${p.unit}“ ist nicht aus Messungen ableitbar – Menge bitte manuell ermitteln.`)]);
  const name = sheetName(`Pos ${p.number}`, used);
  return {
    sheet: {
      name,
      rows: [
        [str(`Pos. ${p.number} – ${lvDocLabel(doc)}`, 'title')],
        [str('Kurztext', 'label'), str(p.shortText)],
        [
          str('Einheit', 'label'),
          str(p.unit),
          str('EP (€)', 'label'),
          p.unitPrice === null ? str('–') : num(p.unitPrice, 'money'),
          str('LV-Menge', 'label'),
          p.quantity === null ? str('–') : num(p.quantity, 'measure'),
        ],
        ['Plan', 'Nr.', 'Messart', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', `Menge (${unit})`, 'Hinweis'].map((h) => str(h, 'header')),
        ...body,
        [],
        ...footer,
        [str('Beträge netto; Mengen aus den zugeordneten Messungen.')],
      ],
      widths: [14, 8, 13, 12, 12, 12, 14, 32],
      headerRows: 4,
      landscape: true,
      print: true,
    } satisfies Sheet,
    total,
    amount,
    sumCell: total === null ? null : `${quoteSheet(name)}!G${sumRow}`,
  };
}

/** Messungen ohne Leistung, Flächen und Linien getrennt summiert. */
function freeSheet(items: { plan: Plan; d: Damage }[], title: string, used: Set<string>): Sheet {
  const first = 3;
  const last = Math.max(first, first + items.length - 1);
  const ds = items.map((x) => x.d);
  return {
    name: sheetName('Freie Messungen', used),
    rows: [
      [str(title, 'title')],
      ['Plan', 'Nr.', 'Messart', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)'].map((h) => str(h, 'header')),
      ...items.map(({ plan, d }) => [
        str(plan.planNumber || plan.planName),
        d.label ? str(d.label) : num(d.number, 'int'),
        str(KIND_LABELS[kindOf(d)]),
        ...measureCols(d),
        d.area === null ? blank() : num(d.area, 'area'),
      ]),
      [],
      [str('Summe Fläche (m²)', 'label'), null, null, null, null, null, { t: 'formula', f: `SUM(G${first}:G${last})`, v: sumAreas(ds), s: 'boldArea' }],
      [str('Summe Länge Linien (m)', 'label'), null, null, { t: 'formula', f: `SUMIF(C${first}:C${last},"Linie",D${first}:D${last})`, v: sumLengths(ds), s: 'boldArea' }],
    ],
    widths: [14, 8, 13, 12, 12, 12, 13],
    headerRows: 2,
    print: true,
  };
}

function exportByPositions(data: ProjectState, scope: XlsxScope, out: BuildOut): ExportFile {
  const used = new Set<string>();
  let plans: Plan[];
  let ccList: CostCenter[];
  let label: string;
  if (scope.kind === 'plan') {
    const plan = data.plans[scope.planId];
    plans = [plan];
    ccList = data.costCenters[plan.costCenterId] ? [data.costCenters[plan.costCenterId]] : [];
    label = plan.planNumber || plan.planName;
  } else if (scope.kind === 'costCenter') {
    const cc = data.costCenters[scope.costCenterId];
    plans = plansOf(data, cc.id);
    ccList = [cc];
    label = costCenterLabel(cc);
  } else {
    ccList = costCentersOf(data);
    plans = ccList.flatMap((cc) => plansOf(data, cc.id));
    label = '';
  }
  const items = plans.flatMap((plan) => damagesOf(data, plan.id).map((d) => ({ plan, d })));
  const title = ['Aufmaß nach Leistungen', data.project.name, label].filter(Boolean).join(' – ');

  // Positionen in LV-Reihenfolge, nur mit zugeordneten Messungen
  const posSheets: Sheet[] = [];
  const summary: Cell[][] = [];
  let amountSum = 0;
  for (const doc of lvDocsOf(data)) {
    for (const p of doc.positions) {
      const ref = positionRef(doc.id, p.id);
      const own = items.filter((x) => x.d.positionRef === ref);
      if (!own.length) continue;
      const r = summary.length + 3;
      const ps = positionSheet(doc, p, own, used);
      posSheets.push(ps.sheet);
      amountSum += ps.amount ?? 0;
      summary.push([
        str(p.number),
        str(p.shortText, 'wrap'),
        str(lvDocLabel(doc)),
        str(p.unit),
        num(own.length, 'int'),
        ps.sumCell === null ? blank() : { t: 'formula', f: ps.sumCell, v: ps.total!, s: quantityBasis(p.unit) === 'count' ? 'int' : 'measure' },
        p.unitPrice === null ? blank() : num(p.unitPrice, 'money'),
        ps.amount === null ? blank() : { t: 'formula', f: `F${r}*G${r}`, v: ps.amount, s: 'money' },
        str(ps.sheet.name, 'note'),
      ]);
    }
  }
  const free = items.filter((x) => !findPosition(data, x.d.positionRef));
  const last = Math.max(3, summary.length + 2);
  const sheets: Sheet[] = [
    {
      name: sheetName('Leistungen', used),
      rows: [
        [str(title, 'title')],
        ['Pos.-Nr.', 'Kurztext', 'LV / MFK', 'EH', 'Messungen', 'Menge', 'EP (€)', 'Betrag (€)', 'Blatt'].map((h) => str(h, 'header')),
        ...(summary.length ? summary : [[str('Keine Messungen mit Leistungszuordnung', 'note')]]),
        [],
        [str('Summe', 'label'), null, null, null, null, null, null, { t: 'formula', f: `SUM(H3:H${last})`, v: Math.round(amountSum * 100) / 100, s: 'boldMoney' }],
        [str(`Freie Messungen (ohne Leistung): ${free.length}`)],
        [str('Beträge netto, nur bei vorhandenem Einheitspreis und ableitbarer Einheit.')],
      ],
      widths: [14, 44, 22, 6, 11, 12, 11, 13, 14],
      headerRows: 2,
      landscape: true,
      print: true,
    },
    ...posSheets,
  ];
  if (free.length) sheets.push(freeSheet(free, 'Freie Messungen (ohne Leistungszuordnung)', used));
  sheets.push(infoSheet(data, ccList, plans, used));
  return {
    name: `${safeFileName(data.project.name, label, 'Aufmass nach Leistungen')}.xlsx`,
    data: out(sheets),
    mimeType: XLSX_MIME,
  };
}
