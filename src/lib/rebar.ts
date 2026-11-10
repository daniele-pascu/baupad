import { round2 } from './numbers';
import type { Damage, RebarItem } from './types';

/**
 * Bewehrung je Messung: mehrere Zeilen „Stück × Länge“, Summe in Laufmetern (lfm).
 * `Damage.rebar` ist immer die Summe (für Tabelle und Excel); `rebarItems` die einzelnen Zeilen.
 */
export const rebarLine = (x: Pick<RebarItem, 'count' | 'length'>) => round2(x.count * x.length);
export const rebarTotal = (items: Pick<RebarItem, 'count' | 'length'>[]) => round2(items.reduce((a, x) => a + rebarLine(x), 0));

/** Zeilen einer Messung; ältere Einträge nur mit Summe → eine Zeile 1 × Summe */
export function rebarItemsOf(d: Pick<Damage, 'rebar' | 'rebarItems'>): Pick<RebarItem, 'count' | 'length'>[] {
  if (d.rebarItems?.length) return d.rebarItems;
  return d.rebar ? [{ count: 1, length: d.rebar }] : [];
}

/** Excel-Formel einer Nummer, z. B. „2*0.2+3*0.2+0.54+3*0.9“ (1 Stück = nur die Länge) */
export function rebarFormula(items: Pick<RebarItem, 'count' | 'length'>[]): string {
  const n = (v: number) => String(Math.round(v * 10000) / 10000);
  return items.map((x) => (x.count === 1 ? n(x.length) : `${n(x.count)}*${n(x.length)}`)).join('+') || '0';
}
/** Summe ungerundet (wie die Excel-Formel), auf 4 Stellen */
export const rebarExact = (items: Pick<RebarItem, 'count' | 'length'>[]) => Math.round(items.reduce((a, x) => a + x.count * x.length, 0) * 10000) / 10000;
