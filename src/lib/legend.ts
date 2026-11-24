import { COLORS, type Damage, type LegendPos, type Plan } from './types';

/** Eintrag der Farblegende eines Plans: erkannte Farbe, Bezeichnung (eigene bzw. Farbname), Anzahl Messungen */
export interface LegendEntry {
  color: string;
  label: string;
  count: number;
}

export const colorName = (c: string) => COLORS.find((x) => x.value.toLowerCase() === c.toLowerCase())?.name ?? c;

/** Alle im Plan verwendeten Farben der Messungen (in der Reihenfolge des ersten Vorkommens) */
export function legendEntries(plan: Pick<Plan, 'legendLabels'>, damages: Damage[]): LegendEntry[] {
  const out = new Map<string, LegendEntry>();
  for (const d of damages) {
    const c = d.color.toLowerCase();
    const e = out.get(c);
    if (e) e.count++;
    else out.set(c, { color: c, label: plan.legendLabels?.[c]?.trim() || colorName(c), count: 1 });
  }
  return [...out.values()];
}

/**
 * Legende eines Plans: gilt nur für diesen Plan – ein-/ausblenden, Lage und Bezeichnungen der Farben werden je Plan
 * eingestellt und nicht mit anderen Plänen verbunden. `plans` bleibt für ältere Aufrufer, wird aber nicht mehr genutzt.
 */
export function resolveLegend(plan: Plan, _plans?: Plan[]): { show: boolean; pos: LegendPos; labels: Record<string, string> } {
  return { show: !!plan.showLegend, pos: plan.legendPos ?? 'bl', labels: { ...(plan.legendLabels ?? {}) } };
}

/** Legende eines Plans (nur aus den Einstellungen dieses Plans) */
export function planLegend(plan: Plan, plans: Plan[], damages: Damage[]): { show: boolean; pos: LegendPos; entries: LegendEntry[] } {
  const r = resolveLegend(plan, plans);
  return { show: r.show, pos: r.pos, entries: legendEntries({ legendLabels: r.labels }, damages) };
}
