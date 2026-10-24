import type { Damage, MeasureKind, Shape } from './types';

/**
 * Messarten und Mengen.
 *
 * Grundregeln: Linienlängen fließen nie in Flächensummen; eine Fläche entsteht nur aus
 * Länge × Breite; eine leere Tiefe bleibt leer (null) und wird nie zu 0.
 */

export const KIND_LABELS: Record<MeasureKind, string> = {
  damage: 'Schadstelle',
  area: 'Fläche',
  line: 'Linie',
};

export const KINDS: MeasureKind[] = ['damage', 'area', 'line'];

export const kindOf = (d: Pick<Damage, 'kind'>): MeasureKind => d.kind ?? 'damage';

/** Messarten mit Fläche (Länge × Breite) */
export const hasArea = (k: MeasureKind) => k !== 'line';

/** Naheliegende Messart für eine Form: offene Linien → Linienmessung. */
export function defaultKindFor(shape: Shape, fallback: MeasureKind): MeasureKind {
  if (shape.type === 'line' || (shape.type === 'freehand' && shape.closed === false)) return 'line';
  return fallback === 'line' ? 'damage' : fallback;
}

const clean = (n: number) => Math.round(n * 1e9) / 1e9;

/** Summe der Flächen (m²) – nur Flächen- und Schadstellenmessungen mit Fläche. */
export function sumAreas(damages: Pick<Damage, 'kind' | 'area'>[]): number {
  return clean(damages.reduce((s, d) => (hasArea(kindOf(d)) && d.area !== null && Number.isFinite(d.area) ? s + d.area : s), 0));
}

/** Summe der Linienlängen (m) – getrennt von den Flächen. */
export function sumLengths(damages: Pick<Damage, 'kind' | 'length'>[]): number {
  return clean(damages.reduce((s, d) => (kindOf(d) === 'line' ? s + d.length : s), 0));
}

export const countKind = (damages: Pick<Damage, 'kind'>[], k: MeasureKind) => damages.filter((d) => kindOf(d) === k).length;
