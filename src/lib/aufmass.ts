import { countKind, KIND_LABELS, kindOf, quantityBasis, quantityFor, sumAreas, sumLengths } from './measure';
import { formatDate, naturalCompare } from './numbers';
import type { ProjectState } from './store';
import { alive } from './store';
import type { Component, CostCenter, Damage, DrawElement, LvDocument, LvPosition, Plan } from './types';
import { blank, buildXlsx, colName, num, sheetName, str, type Cell, type Sheet } from './xlsx';

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

/** Anzeige einer Kostenstelle: „4711 – Tiefgarage“, nur Nummer oder nur Bezeichnung. */
export function costCenterLabel(cc: Pick<CostCenter, 'number' | 'name'> | undefined): string {
  if (!cc) return '';
  return [cc.number?.trim(), cc.name.trim()].filter(Boolean).join(' – ') || 'Kostenstelle';
}

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
    num(damage.number, 'int'),
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
    [str('Baustelle', 'label'), str(p.site)],
    [str('Adresse / Standort', 'label'), str(p.address)],
    [str('Auftraggeber', 'label'), str(p.client)],
    [str('Bearbeiter', 'label'), str(p.editor)],
    [str('Datum', 'label'), str(formatDate(p.date))],
    [str('Kostenstelle(n)', 'label'), str(costCenters.map((c) => costCenterLabel(c)).join(', '))],
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

/**
 * Excel-Export.
 * - 'standard' (Neu, Standard): je Plan ein druckfertiges Blatt (A1 = Plan, Zeile 2 = Überschriften),
 *   dazu Übersicht, LV/MFK-Auswertung und nicht zugeordnete Messungen.
 * - 'classic': bisheriger Export – eine Tabelle je Kostenstelle mit Plannummer in Spalte A.
 */
export function exportXlsx(data: ProjectState, scope: XlsxScope, layout: 'standard' | 'classic' = 'standard'): ExportFile {
  return layout === 'classic' ? exportClassic(data, scope) : exportStandard(data, scope);
}

function exportClassic(data: ProjectState, scope: XlsxScope): ExportFile {
  const used = new Set<string>();
  const ccs = costCentersOf(data);
  if (scope.kind === 'plan') {
    const plan = data.plans[scope.planId];
    const cc = data.costCenters[plan.costCenterId];
    const sheet = aufmassSheet(sheetName(plan.planNumber || 'Aufmaß', used), aufmassRows(data, [plan]));
    return {
      name: `${safeFileName(data.project.name, costCenterLabel(cc), plan.planNumber || plan.planName, 'Aufmass')}.xlsx`,
      data: buildXlsx([sheet, infoSheet(data, cc ? [cc] : [], [plan], used)]),
      mimeType: XLSX_MIME,
    };
  }
  if (scope.kind === 'costCenter') {
    const cc = data.costCenters[scope.costCenterId];
    const plans = plansOf(data, cc.id);
    const sheet = aufmassSheet(sheetName(costCenterLabel(cc), used), aufmassRows(data, plans));
    return {
      name: `${safeFileName(data.project.name, costCenterLabel(cc), 'Aufmass')}.xlsx`,
      data: buildXlsx([sheet, infoSheet(data, [cc], plans, used)]),
      mimeType: XLSX_MIME,
    };
  }
  // Gesamtprojekt: ein Tabellenblatt je Kostenstelle
  const sheets: Sheet[] = [];
  const allPlans: Plan[] = [];
  for (const cc of ccs) {
    const plans = plansOf(data, cc.id);
    allPlans.push(...plans);
    sheets.push(aufmassSheet(sheetName(costCenterLabel(cc), used), aufmassRows(data, plans)));
  }
  if (!sheets.length) sheets.push(aufmassSheet(sheetName('Aufmaß', used), []));
  sheets.push(infoSheet(data, ccs, allPlans, used));
  return {
    name: `${safeFileName(data.project.name, 'Aufmass')}.xlsx`,
    data: buildXlsx(sheets),
    mimeType: XLSX_MIME,
  };
}

// ---------------------------------------------------------------------------
// Neues Excel-Layout (Standard)

/** Druckfertiges Aufmaßblatt eines Plans: A1 = Plan, Zeile 2 = Überschriften, ab Zeile 3 Messungen. */
export function planSheet(data: ProjectState, plan: Plan, used: Set<string>): Sheet {
  const damages = damagesOf(data, plan.id);
  const showKind = damages.some((d) => kindOf(d) !== 'damage');
  // Bauteilbuchstaben werden in der Oberfläche nicht mehr verwendet – im Export ausgeblendet
  const showComp = false;
  const showPos = damages.some((d) => findPosition(data, d.positionRef));
  const headers = ['Nr.', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)'];
  if (showKind) headers.push('Messart');
  if (showComp) headers.push('Bauteil');
  if (showPos) headers.push('Leistung');
  const kindCol = headers.indexOf('Messart');
  const body: Cell[][] = damages.map((d) => {
    const row: Cell[] = [
      num(d.number, 'int'),
      num(d.length, 'measure'),
      d.width === null ? blank() : num(d.width, 'measure'),
      // leere Tiefe bleibt leer (nicht 0)
      d.depth === null ? blank() : num(d.depth, 'measure'),
      d.area === null ? blank() : num(d.area, 'area'),
    ];
    if (showKind) row.push(str(KIND_LABELS[kindOf(d)]));
    if (showComp) {
      const c = d.componentId ? data.components[d.componentId] : undefined;
      row.push(str(c && !c.deletedAt ? (c.name ? `${c.letter} – ${c.name}` : c.letter) : ''));
    }
    if (showPos) row.push(str(findPosition(data, d.positionRef)?.pos.number ?? ''));
    return row;
  });
  const first = 3;
  const last = Math.max(first, damages.length + 2);
  const sums: Cell[][] = [
    [
      str('Summe Fläche (m²)', 'label'),
      null,
      null,
      null,
      damages.length ? { t: 'formula', f: `SUM(E${first}:E${last})`, v: sumAreas(damages), s: 'boldArea' } : num(0, 'boldArea'),
    ],
  ];
  if (countKind(damages, 'line') && kindCol >= 0) {
    const k = colName(kindCol);
    sums.push([
      str('Summe Länge Linien (m)', 'label'),
      { t: 'formula', f: `SUMIF(${k}${first}:${k}${last},"Linie",B${first}:B${last})`, v: sumLengths(damages), s: 'boldArea' },
    ]);
  }
  const widths = [8, 12, 12, 12, 13, ...headers.slice(5).map((h) => (h === 'Leistung' ? 14 : h === 'Bauteil' ? 16 : 13))];
  return {
    name: sheetName(plan.planNumber || plan.planName || 'Plan', used),
    rows: [[str(`Plan ${planTitle(plan)}`, 'title')], headers.map((h) => str(h, 'header')), ...body, [], ...sums],
    widths,
    headerRows: 2,
    print: true,
  };
}

/** Übersicht über alle Pläne der Auswahl mit Summen. */
function overviewSheet(data: ProjectState, plans: Plan[], title: string, used: Set<string>): Sheet {
  const headers = ['Kostenstelle', 'Plan', 'Bezeichnung / Ebene', 'Messungen', 'Fläche (m²)', 'Länge Linien (m)'];
  const body: Cell[][] = plans.map((p) => {
    const ds = damagesOf(data, p.id);
    return [
      str(costCenterLabel(data.costCenters[p.costCenterId])),
      str(p.planNumber),
      str([p.planName, p.floor].filter(Boolean).join(' · ')),
      num(ds.length, 'int'),
      num(sumAreas(ds), 'area'),
      num(sumLengths(ds), 'measure'),
    ];
  });
  const last = Math.max(3, plans.length + 2);
  const all = plans.flatMap((p) => damagesOf(data, p.id));
  return {
    name: sheetName('Übersicht', used),
    rows: [
      [str(title, 'title')],
      headers.map((h) => str(h, 'header')),
      ...body,
      [],
      [
        str('Summe', 'label'),
        null,
        null,
        { t: 'formula', f: `SUM(D3:D${last})`, v: all.length, s: 'boldText' },
        { t: 'formula', f: `SUM(E3:E${last})`, v: sumAreas(all), s: 'boldArea' },
        { t: 'formula', f: `SUM(F3:F${last})`, v: sumLengths(all), s: 'boldArea' },
      ],
    ],
    widths: [22, 12, 28, 11, 13, 16],
    headerRows: 2,
    landscape: true,
    print: true,
  };
}

/**
 * Auswertung eines LV bzw. einer MFK: LV-Menge und Aufmaßmenge getrennt, Differenz und
 * Beträge nur bei vorhandenen Werten und passender Einheit (nichts wird erfunden).
 */
function lvSheet(doc: LvDocument, damages: Damage[], used: Set<string>): Sheet {
  const headers = ['Pos.-Nr.', 'Kurztext', 'EH', 'LV-Menge', 'Aufmaß-Menge', 'Differenz', 'EP (€)', 'GP LV (€)', 'GP Aufmaß (€)', 'Hinweis'];
  const rows: Cell[][] = [];
  let r = 3;
  let lvSum = 0;
  let measuredSum = 0;
  for (const g of doc.groups.filter((x) => x.number.split(' ').length <= 2)) {
    const positions = doc.positions.filter((p) => p.group === g.number);
    if (!positions.length) continue;
    rows.push([str(g.number, 'label'), str(g.title, 'label')]);
    r++;
    for (const p of positions) rows.push(lvRow(doc, p, damages, r++, (a, b) => ((lvSum += a), (measuredSum += b))));
  }
  for (const p of doc.positions.filter((x) => !doc.groups.some((g) => g.number === x.group && x.group.split(' ').length <= 2)))
    rows.push(lvRow(doc, p, damages, r++, (a, b) => ((lvSum += a), (measuredSum += b))));
  const last = Math.max(3, r - 1);
  return {
    name: sheetName(`${doc.kind === 'lv' ? 'LV' : 'MFK'} ${doc.number || doc.name}`, used),
    rows: [
      [str(lvDocLabel(doc), 'title')],
      headers.map((h) => str(h, 'header')),
      ...rows,
      [],
      [
        str('Summe', 'label'),
        null,
        null,
        null,
        null,
        null,
        null,
        { t: 'formula', f: `SUM(H3:H${last})`, v: Math.round(lvSum * 100) / 100, s: 'boldMoney' },
        { t: 'formula', f: `SUM(I3:I${last})`, v: Math.round(measuredSum * 100) / 100, s: 'boldMoney' },
      ],
      [null, str('Beträge netto; Aufmaß-Mengen aus den zugeordneten Messungen, LV-Mengen unverändert.', 'note')],
    ],
    widths: [13, 42, 6, 11, 13, 11, 11, 13, 14, 30],
    headerRows: 2,
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
    str(p.number),
    str(p.shortText, 'wrap'),
    str(p.unit),
    p.quantity === null ? blank() : num(p.quantity, 'measure'),
    q.value === null ? blank() : num(q.value, 'measure'),
    p.quantity !== null && q.value !== null ? { t: 'formula', f: `E${row}-D${row}`, v: q.value - p.quantity, s: 'measure' } : blank(),
    p.unitPrice === null ? blank() : num(p.unitPrice, 'money'),
    p.totalPrice === null ? blank() : num(p.totalPrice, 'money'),
    measuredAmount === null ? blank() : { t: 'formula', f: `E${row}*G${row}`, v: measuredAmount, s: 'money' },
    str(notes.join('; '), 'note'),
  ];
}

/** Messungen ohne Leistungszuordnung (nur, wenn es LV/MFK gibt). */
function unassignedSheet(data: ProjectState, plans: Plan[], used: Set<string>): Sheet | null {
  const rows = plans.flatMap((p) => damagesOf(data, p.id).filter((d) => !findPosition(data, d.positionRef)).map((d) => ({ p, d })));
  if (!rows.length) return null;
  return {
    name: sheetName('Ohne Leistung', used),
    rows: [
      [str('Messungen ohne Leistungszuordnung', 'title')],
      ['Plan', 'Nr.', 'Messart', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)'].map((h) => str(h, 'header')),
      ...rows.map(({ p, d }) => [
        str(p.planNumber),
        num(d.number, 'int'),
        str(KIND_LABELS[kindOf(d)]),
        num(d.length, 'measure'),
        d.width === null ? blank() : num(d.width, 'measure'),
        d.depth === null ? blank() : num(d.depth, 'measure'),
        d.area === null ? blank() : num(d.area, 'area'),
      ]),
    ],
    widths: [14, 8, 13, 12, 12, 12, 13],
    headerRows: 2,
    print: true,
  };
}

function exportStandard(data: ProjectState, scope: XlsxScope): ExportFile {
  const used = new Set<string>();
  const ccs = costCentersOf(data);
  let plans: Plan[];
  let ccList: CostCenter[];
  let name: string;
  let title: string;
  if (scope.kind === 'plan') {
    const plan = data.plans[scope.planId];
    const cc = data.costCenters[plan.costCenterId];
    plans = [plan];
    ccList = cc ? [cc] : [];
    name = safeFileName(data.project.name, costCenterLabel(cc), plan.planNumber || plan.planName, 'Aufmass');
    title = '';
  } else if (scope.kind === 'costCenter') {
    const cc = data.costCenters[scope.costCenterId];
    plans = plansOf(data, cc.id);
    ccList = [cc];
    name = safeFileName(data.project.name, costCenterLabel(cc), 'Aufmass');
    title = `Aufmaß ${data.project.name} – ${costCenterLabel(cc)}`;
  } else {
    plans = ccs.flatMap((cc) => plansOf(data, cc.id));
    ccList = ccs;
    name = safeFileName(data.project.name, 'Aufmass');
    title = `Aufmaß ${data.project.name}`;
  }
  const sheets: Sheet[] = [];
  if (scope.kind !== 'plan') sheets.push(overviewSheet(data, plans, title, used));
  for (const p of plans) sheets.push(planSheet(data, p, used));
  if (!plans.length) sheets.push({ name: sheetName('Aufmaß', used), rows: [[str('Keine Pläne', 'title')]], widths: [20] });
  // LV/MFK-Auswertung (Mengen aus den Messungen der exportierten Pläne)
  if (scope.kind !== 'plan') {
    const docs = lvDocsOf(data);
    const damages = plans.flatMap((p) => damagesOf(data, p.id));
    for (const doc of docs) sheets.push(lvSheet(doc, damages, used));
    if (docs.length) {
      const un = unassignedSheet(data, plans, used);
      if (un) sheets.push(un);
    }
  }
  sheets.push(infoSheet(data, ccList, plans, used));
  return { name: `${name}.xlsx`, data: buildXlsx(sheets), mimeType: XLSX_MIME };
}
