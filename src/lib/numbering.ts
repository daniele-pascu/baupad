import type { Damage } from './types';

/**
 * Schadstellennummerierung – getrennt je Plan.
 *
 * Neue Schadstellen erhalten die nächsthöhere Nummer (Start standardmäßig 0). Beim Löschen
 * wird nichts automatisch umnummeriert, damit bereits notierte Nummern gültig bleiben.
 */
export function nextNumber(damages: Pick<Damage, 'number'>[], numberStart = 0): number {
  if (!damages.length) return numberStart;
  return Math.max(numberStart - 1, ...damages.map((d) => d.number)) + 1;
}

export function findByNumber<T extends Pick<Damage, 'id' | 'number'>>(
  damages: T[],
  number: number,
  exceptId?: string,
): T | undefined {
  return damages.find((d) => d.number === number && d.id !== exceptId);
}

export function parseDamageNumber(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return Number(s);
}

/**
 * Kontrollierte Umnummerierung: Schadstelle `id` erhält `target`; alle anderen Schadstellen
 * mit Nummer ≥ target rücken um 1 nach oben, bis eine Lücke erreicht ist.
 * Gibt die geänderten Nummern als Map id → neue Nummer zurück.
 */
export function shiftNumbers<T extends Pick<Damage, 'id' | 'number'>>(
  damages: T[],
  id: string,
  target: number,
): Map<string, number> {
  const others = damages.filter((d) => d.id !== id).sort((a, b) => a.number - b.number);
  const changes = new Map<string, number>();
  changes.set(id, target);
  let expected = target;
  for (const d of others) {
    if (d.number < target) continue;
    if (d.number > expected) break; // Lücke erreicht – Rest bleibt unverändert
    expected = d.number + 1;
    changes.set(d.id, d.number + 1);
  }
  return changes;
}

/** Tausch: Schadstelle `id` erhält `target`, der bisherige Inhaber von `target` die alte Nummer. */
export function swapNumbers<T extends Pick<Damage, 'id' | 'number'>>(
  damages: T[],
  id: string,
  target: number,
): Map<string, number> {
  const self = damages.find((d) => d.id === id);
  const other = findByNumber(damages, target, id);
  const changes = new Map<string, number>();
  changes.set(id, target);
  if (other && self) changes.set(other.id, self.number);
  return changes;
}

/** Lückenlose Neunummerierung in bestehender Reihenfolge ab Startnummer. */
export function compactNumbers<T extends Pick<Damage, 'id' | 'number'>>(
  damages: T[],
  start = 0,
): Map<string, number> {
  const changes = new Map<string, number>();
  [...damages]
    .sort((a, b) => a.number - b.number)
    .forEach((d, i) => {
      if (d.number !== start + i) changes.set(d.id, start + i);
    });
  return changes;
}

/** Prüft, ob innerhalb eines Plans Nummern doppelt vergeben sind. */
export function duplicateNumbers(damages: Pick<Damage, 'number'>[]): number[] {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const d of damages) {
    if (seen.has(d.number)) dup.add(d.number);
    seen.add(d.number);
  }
  return [...dup].sort((a, b) => a - b);
}
