import { sumAreas } from './measure';
import { formatDate, naturalCompare } from './numbers';
import type { ProjectState } from './store';
import { alive } from './store';
import type { Component, CostCenter, Damage, DrawElement, Plan } from './types';
import { buildXlsx, num, sheetName, str, type Cell, type Sheet } from './xlsx';

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
  return { name: sheetName('Projektdaten', used), rows, widths: [22, 16, 28, 14, 18, 28, 8, 12, 14] };
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

export function exportXlsx(data: ProjectState, scope: XlsxScope): ExportFile {
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
