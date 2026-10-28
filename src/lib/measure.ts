import type { Damage, Deduction, MeasureKind, Shape } from './types';

/**
 * Messarten und Mengen.
 *
 * Grundregeln: Linienlängen fließen nie in Flächensummen; eine Fläche entsteht nur aus
 * Länge × Breite oder – auf kalibrierten bzw. gezeichneten Plänen – aus der Form selbst
 * (areaFromShape); eine leere Tiefe bleibt leer (null) und wird nie zu 0.
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

/**
 * Wand: Flächenmessung mit offenem Verlauf (Linie mit Knicken). Länge = alle Abschnitte,
 * Höhe im Feld „Breite/Höhe“, Wandfläche = Länge × Höhe (ohne Höhe keine Fläche).
 */
export const isWall = (d: Pick<Damage, 'kind' | 'shape'>) =>
  hasArea(kindOf(d)) && (d.shape.type === 'line' || (d.shape.type === 'freehand' && d.shape.closed === false));

/** Bezeichnung einer Messung: „Wand“ bzw. die Messart */
export const measureLabel = (d: Pick<Damage, 'kind' | 'shape'>) => (isWall(d) ? 'Wand' : KIND_LABELS[kindOf(d)]);

/** Messart aus der Form (keine Auswahl beim Einfügen): offene Linien → Linie, geschlossene Formen → Fläche. */
export function defaultKindFor(shape: Shape): MeasureKind {
  return shape.type === 'line' || (shape.type === 'freehand' && shape.closed === false) ? 'line' : 'area';
}

const clean = (n: number) => Math.round(n * 1e9) / 1e9;

/** Teilfläche einer Abzugs- bzw. Zuschlagszeile mit Vorzeichen (Abzug negativ) */
export const deductionArea = (x: Pick<Deduction, 'count' | 'length' | 'width' | 'add'>) => clean((x.add ? 1 : -1) * x.count * x.length * (x.width ?? 0));

/** Teillänge einer Abzugs- bzw. Zuschlagszeile einer Linie mit Vorzeichen (Abzug negativ) */
export const deductionLength = (x: Pick<Deduction, 'count' | 'length' | 'add'>) => clean((x.add ? 1 : -1) * x.count * x.length);

/** Nettolänge: Linien mit Abzügen/Zuschlägen; sonst die gemessene Länge (bei Flächen z. B. der Umfang) */
export function netLength(d: Pick<Damage, 'kind' | 'length' | 'deductions'>): number {
  if (kindOf(d) !== 'line' || !d.deductions?.length) return d.length;
  return clean(d.deductions.reduce((s, x) => s + deductionLength(x), d.length));
}

/** Nettofläche: Bruttofläche (Länge × Breite bzw. aus dem Plan) mit Abzügen und Zuschlägen */
export function netArea(gross: number | null, deductions: Deduction[] | undefined): number | null {
  if (gross === null || !deductions?.length) return gross;
  return clean(deductions.reduce((s, x) => s + deductionArea(x), gross));
}

/** Kurztext der Abzüge/Zuschläge, z. B. „− 2,10 m² (Tür) + 0,50 m² (Nische)“ bzw. bei Linien „− 1,00 m (Tür)“ */
export function deductionText(list: Deduction[], line = false): string {
  const f = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return list
    .map((x) => {
      const a = line ? deductionLength(x) : deductionArea(x);
      const name = [x.count > 1 ? `${x.count}×` : '', x.label].filter(Boolean).join(' ');
      return `${a < 0 ? '−' : '+'} ${f(Math.abs(a))} ${line ? 'm' : 'm²'}${name ? ` (${name})` : ''}`;
    })
    .join(' ');
}

/** Bruttofläche einer gespeicherten Messung (`area` ist netto) */
export function grossArea(d: Pick<Damage, 'area' | 'deductions'>): number | null {
  if (d.area === null || !d.deductions?.length) return d.area;
  return clean(d.deductions.reduce((s, x) => s - deductionArea(x), d.area));
}

/** Summe der Flächen (m²) – nur Flächen- und Schadstellenmessungen mit Fläche. */
export function sumAreas(damages: Pick<Damage, 'kind' | 'area'>[]): number {
  return clean(damages.reduce((s, d) => (hasArea(kindOf(d)) && d.area !== null && Number.isFinite(d.area) ? s + d.area : s), 0));
}

/** Summe der Linienlängen (m) – getrennt von den Flächen. */
export function sumLengths(damages: Pick<Damage, 'kind' | 'length' | 'deductions'>[]): number {
  return clean(damages.reduce((s, d) => (kindOf(d) === 'line' ? s + netLength(d) : s), 0));
}

export const countKind = (damages: Pick<Damage, 'kind'>[], k: MeasureKind) => damages.filter((d) => kindOf(d) === k).length;

/** Summe der Volumen (m³) – nur Messungen mit Fläche und Tiefe; fehlende Werte zählen nicht als 0. */
export function sumVolumes(damages: Pick<Damage, 'kind' | 'area' | 'depth'>[]): number {
  return clean(damages.reduce((s, d) => (hasArea(kindOf(d)) && d.area !== null && d.depth !== null ? s + d.area * d.depth : s), 0));
}
export const hasVolume = (damages: Pick<Damage, 'kind' | 'area' | 'depth'>[]) => damages.some((d) => hasArea(kindOf(d)) && d.area !== null && d.depth !== null);

/** Art der Mengenermittlung je LV-Einheit */
export type QuantityBasis = 'area' | 'length' | 'volume' | 'count' | null;

/** Welche Messgröße zur Einheit einer Leistungsposition passt. */
export function quantityBasis(unit: string): QuantityBasis {
  const u = unit.trim().toLowerCase().replace(/\s/g, '');
  if (['m²', 'm2', 'qm'].includes(u)) return 'area';
  if (['m', 'lfm', 'lm', 'lfdm'].includes(u)) return 'length';
  if (['m³', 'm3', 'cbm'].includes(u)) return 'volume';
  if (['stk', 'st', 'stück', 'stueck'].includes(u)) return 'count';
  return null; // z. B. PA, h, Wo – nicht aus Messungen ableitbar
}

/**
 * Aufmaßmenge einer Position aus den zugeordneten Messungen:
 * m² = Summe der Flächen, m = Summe der Längen, m³ = Fläche × Tiefe (nur mit Tiefe),
 * Stk = Anzahl. Bei anderen Einheiten null (nicht automatisch berechenbar).
 */
export function quantityFor(unit: string, damages: Pick<Damage, 'kind' | 'length' | 'area' | 'depth' | 'deductions'>[]): { value: number | null; missing: number } {
  const basis = quantityBasis(unit);
  if (!basis) return { value: null, missing: 0 };
  if (basis === 'count') return { value: damages.length, missing: 0 };
  if (basis === 'length') return { value: clean(damages.reduce((s, d) => s + netLength(d), 0)), missing: 0 };
  if (basis === 'area') {
    const withArea = damages.filter((d) => hasArea(kindOf(d)) && d.area !== null);
    return { value: sumAreas(withArea), missing: damages.length - withArea.length };
  }
  const withDepth = damages.filter((d) => hasArea(kindOf(d)) && d.area !== null && d.depth !== null);
  return { value: clean(withDepth.reduce((s, d) => s + d.area! * d.depth!, 0)), missing: damages.length - withDepth.length };
}
