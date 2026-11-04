import { COLORS, type Damage, type Plan } from './types';

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
