import { isOpenShape } from './geometry';
import { kindOf } from './measure';
import { COLORS, type Damage, type LegendPos, type Plan, type Shape, type ShapeStyle } from './types';

/** Eintrag der Legende eines Plans: erkanntes Aussehen (Farbe, Linie bzw. Fläche), Bezeichnung, Anzahl Messungen */
export interface LegendEntry {
  /** Schlüssel des Aussehens (Bezeichnungen werden darunter gespeichert; Standard-Fläche = nur die Farbe) */
  key: string;
  color: string;
  /** Muster: Linie (Länge), Fläche (Rand, Füllung, Schraffur) oder Punkte (Stück) */
  sample: 'line' | 'area' | 'points';
  style?: ShapeStyle;
  label: string;
  count: number;
}

export const colorName = (c: string) => COLORS.find((x) => x.value.toLowerCase() === c.toLowerCase())?.name ?? c;

const LINE_KEYS: (keyof ShapeStyle)[] = ['lineType', 'lineWidth', 'dashScale', 'lineTransparency'];

/** Aussehen einer Messung: Muster und die Stil-Angaben, die es sichtbar verändern */
function lookOf(d: Pick<Damage, 'color' | 'kind' | 'shape' | 'style'>): Pick<LegendEntry, 'key' | 'color' | 'sample' | 'style'> {
  const color = d.color.toLowerCase();
  const sample = d.style?.points ? 'points' : kindOf(d) === 'line' || isOpenShape(d.shape) ? 'line' : 'area';
  const keys = sample === 'points' ? [] : sample === 'line' ? LINE_KEYS : (Object.keys(d.style ?? {}) as (keyof ShapeStyle)[]).sort();
  const style = Object.fromEntries(keys.filter((k) => d.style?.[k] !== undefined).map((k) => [k, d.style![k]])) as ShapeStyle;
  const sig = Object.keys(style).length ? JSON.stringify(style) : '';
  // Standard-Fläche behält den alten Schlüssel (nur Farbe), damit gespeicherte Bezeichnungen gelten
  const key = sample === 'area' && !sig ? color : `${color}|${sample}${sig ? `|${sig}` : ''}`;
  return { key, color, sample, ...(sig ? { style } : {}) };
}

/** Alle im Plan verwendeten Aussehen der Messungen (Farbe und Linie bzw. Fläche; Reihenfolge des ersten Vorkommens) */
export function legendEntries(plan: Pick<Plan, 'legendLabels'>, damages: Damage[]): LegendEntry[] {
  const out = new Map<string, LegendEntry>();
  for (const d of damages) {
    const look = lookOf(d);
    const e = out.get(look.key);
    if (e) e.count++;
    else out.set(look.key, { ...look, label: plan.legendLabels?.[look.key]?.trim() || plan.legendLabels?.[look.color]?.trim() || colorName(look.color), count: 1 });
  }
  return [...out.values()];
}

/**
 * Legende eines Plans: im PDF standardmäßig an (bis sie in diesem Plan ausgeschaltet wird); gilt nur für diesen Plan – ein-/ausblenden, Lage und Bezeichnungen der Farben werden je Plan
 * eingestellt und nicht mit anderen Plänen verbunden. `plans` bleibt für ältere Aufrufer, wird aber nicht mehr genutzt.
 */
export function resolveLegend(plan: Plan, _plans?: Plan[]): { show: boolean; pos: LegendPos; labels: Record<string, string> } {
  return { show: plan.showLegend ?? true, pos: plan.legendPos ?? 'bl', labels: { ...(plan.legendLabels ?? {}) } };
}

/** Legende eines Plans (nur aus den Einstellungen dieses Plans) */
export function planLegend(plan: Plan, plans: Plan[], damages: Damage[]): { show: boolean; pos: LegendPos; entries: LegendEntry[] } {
  const r = resolveLegend(plan, plans);
  return { show: r.show, pos: r.pos, entries: legendEntries({ legendLabels: r.labels }, damages) };
}

/** Musterform eines Eintrags in Punkten (y nach unten): Linie waagrecht in der Mitte, Fläche als Kasten */
export function legendSampleShape(sample: LegendEntry['sample'], w: number, h: number): Shape {
  const pad = 1.5;
  return sample === 'line'
    ? { type: 'line', x: pad, y: h / 2, w: w - 2 * pad, h: 0, points: [[0, 0], [1, 0]] }
    : { type: 'rect', x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
}

/** Linienstärke im Muster (pt): die eigene, begrenzt, damit dicke Linien das Feld nicht füllen */
export const legendLineWidth = (e: Pick<LegendEntry, 'style'>) => Math.min(3.5, Math.max(0.6, e.style?.lineWidth ?? 1.2));
