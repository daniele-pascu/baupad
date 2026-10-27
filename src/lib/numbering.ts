import type { Damage } from './types';

/**
 * Schadstellennummerierung – getrennt je Plan.
 *
 * Neue Schadstellen erhalten die nächsthöhere Nummer (Start immer mindestens bei 1). Beim
 * Löschen wird nichts automatisch umnummeriert, damit bereits notierte Nummern gültig bleiben.
 */
export const MIN_NUMBER = 1;

/** Startnummer eines Plans; ältere Pläne mit Startnummer 0 beginnen ebenfalls bei 1. */
export function planNumberStart(plan: { numberStart?: number }): number {
  return Math.max(MIN_NUMBER, plan.numberStart ?? MIN_NUMBER);
}

export function nextNumber(damages: Pick<Damage, 'number'>[], numberStart = MIN_NUMBER): number {
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
  const n = Number(s);
  return n >= MIN_NUMBER ? n : null;
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
  start = MIN_NUMBER,
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

// ---------------------------------------------------------------------------
// Kennzeichnungen aus Zahlen und Buchstaben (z. B. „A“, „Wand B“, „1A“)

/** Angezeigte Nummer bzw. Kennzeichnung einer Messung. */
export const damageNo = (d: Pick<Damage, 'number' | 'label'>): string => d.label?.trim() || String(d.number);

const nextLetters = (s: string): string => {
  // A → B, Z → AA, AZ → BA (Groß-/Kleinschreibung bleibt erhalten)
  const upper = s === s.toUpperCase();
  const chars = s.toUpperCase().split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      break;
    }
    chars[i] = 'A';
    i--;
  }
  const out = (i < 0 ? 'A' : '') + chars.join('');
  return upper ? out : out.toLowerCase();
};

/**
 * Nächste Kennzeichnung nach einem eindeutigen Schema – sonst null (dann manuelle Eingabe):
 * „12“ → „13“, „A“ → „B“, „Z“ → „AA“, „Wand A“ → „Wand B“, „1A“ → „1B“, „A1“ → „A2“, „P-09“ → „P-10“.
 * Nicht eindeutig sind z. B. „Wand“ (Wort ohne Zähler) oder Kennzeichnungen ohne Buchstaben/Ziffern am Ende.
 */
export function nextLabel(prev: string): string | null {
  const s = prev.trim();
  const digits = /^(.*?)(\d+)$/.exec(s);
  if (digits) {
    const [, head, n] = digits;
    const next = String(Number(n) + 1).padStart(n.length, '0');
    return head + next;
  }
  // Am Ende 1–2 Buchstaben (gleiche Schreibweise), davor Anfang, Leerzeichen, Ziffer oder Zeichen
  const letters = /^(.*?)([A-Za-z]{1,2})$/.exec(s);
  if (letters) {
    const [, head, l] = letters;
    if (l !== l.toUpperCase() && l !== l.toLowerCase()) return null;
    if (head && /[A-Za-zÄÖÜäöüß]$/.test(head)) return null; // Teil eines Wortes, z. B. „Wand“
    return head + nextLetters(l);
  }
  return null;
}

/**
 * Vorschlag für die nächste Messung eines Plans: Das Schema der zuletzt angelegten Messung wird
 * fortgesetzt (Zahl bzw. Kennzeichnung). Ist es nicht eindeutig, bleibt die Kennzeichnung leer.
 */
export function suggestNext(
  damages: Pick<Damage, 'id' | 'number' | 'label' | 'createdAt'>[],
  numberStart = MIN_NUMBER,
): { number: number; label: string | null } {
  const plain = damages.filter((d) => !d.label?.trim());
  const last = [...damages].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!last || !last.label?.trim()) return { number: nextNumber(plain, numberStart), label: null };
  const used = new Set(damages.map((d) => damageNo(d).toLowerCase()));
  let cand = nextLabel(last.label);
  for (let i = 0; cand && used.has(cand.toLowerCase()) && i < 200; i++) cand = nextLabel(cand);
  return { number: nextNumber(damages, numberStart), label: cand && !used.has(cand.toLowerCase()) ? cand : '' };
}

/** Messungen mit doppelt vergebener Nummer bzw. Kennzeichnung (Groß-/Kleinschreibung egal). */
export function duplicateIds(damages: Pick<Damage, 'id' | 'number' | 'label'>[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const d of damages) {
    const k = damageNo(d).toLowerCase();
    byKey.set(k, [...(byKey.get(k) ?? []), d.id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

/** Nächste Positionsnummer vorschlagen: „1“ → „2“, „01.01“ → „01.02“, „92 01 01 A“ → „92 01 01 B“, „…07C.“ → „…07D.“ */
export function nextPositionNumber(prev: string): string {
  const t = prev.trim();
  const letter = /^(.*[\s.\d])([A-Y])(\.?)$/.exec(t);
  if (letter) return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1) + letter[3];
  const m = /^(.*?)(\d+)(\D*)$/.exec(t);
  if (!m) return '';
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}
