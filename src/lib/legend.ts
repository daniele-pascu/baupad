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
 * Legende eines Plans mit Vorgaben aus den anderen Plänen des Projekts: Ist die Legende in einem Plan an, steht sie
 * auch in allen Plänen ohne eigene Einstellung (z. B. neu importierten) – jeder Plan mit seinen eigenen Farben.
 * Bezeichnungen: eigene des Plans, sonst die aus anderen Plänen (gleiche Farbe = gleiche Bedeutung).
 */
export function resolveLegend(plan: Plan, plans: Plan[]): { show: boolean; pos: LegendPos; labels: Record<string, string> } {
  const others = plans.filter((p) => p.id !== plan.id && !p.deletedAt && p.projectId === plan.projectId);
  const lead = others.find((p) => p.showLegend);
  const labels: Record<string, string> = {};
  for (const p of others) for (const [c, t] of Object.entries(p.legendLabels ?? {})) if (t.trim() && !(c in labels)) labels[c] = t;
  return {
    show: plan.showLegend ?? !!lead,
    pos: plan.legendPos ?? lead?.legendPos ?? 'bl',
    labels: { ...labels, ...(plan.legendLabels ?? {}) },
  };
}

/** Legende eines Plans (mit Vorgaben aus dem Projekt) */
export function planLegend(plan: Plan, plans: Plan[], damages: Damage[]): { show: boolean; pos: LegendPos; entries: LegendEntry[] } {
  const r = resolveLegend(plan, plans);
  return { show: r.show, pos: r.pos, entries: legendEntries({ legendLabels: r.labels }, damages) };
}
