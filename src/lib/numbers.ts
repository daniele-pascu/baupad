/**
 * Zahlen-Eingabe und -Ausgabe im deutschen Format (Dezimalkomma).
 */

/**
 * Liest eine Maßangabe in Metern. Akzeptiert Komma oder Punkt als Dezimaltrennzeichen
 * sowie eine optionale Einheit „m“. Gibt null zurück, wenn die Eingabe leer oder
 * keine gültige Zahl ist.
 */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(/\s*m$/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export type MeasureCheck = { ok: true; value: number } | { ok: false; error: string };

/** Prüft ein Maß: Pflichtfeld, positive Zahl, plausibel begrenzt. */
export function checkMeasure(input: string, label: string): MeasureCheck {
  if (!input.trim()) return { ok: false, error: `${label} fehlt.` };
  const n = parseDecimal(input);
  if (n === null) return { ok: false, error: `${label}: „${input}“ ist keine gültige Zahl.` };
  if (n <= 0) return { ok: false, error: `${label} muss größer als 0 sein.` };
  if (n >= 10000) return { ok: false, error: `${label} ist unplausibel groß.` };
  return { ok: true, value: n };
}

/**
 * Fläche in m² = Länge × Breite. Es wird nur das Gleitkomma-Rauschen der Multiplikation
 * entfernt (1,5 × 0,8 ergibt sonst 1,2000000000000002); fachlich gerundet wird erst bei
 * der Anzeige.
 */
export function computeArea(length: number, width: number): number {
  return Math.round(length * width * 1e9) / 1e9;
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function fmt(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max });
    fmtCache.set(key, f);
  }
  return f;
}

/** Maße: mindestens 2, höchstens 3 Nachkommastellen (z. B. 1,50 oder 0,125). */
export function formatMeasure(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return fmt(2, 3).format(n);
}

/** Flächen: 2 Nachkommastellen. */
export function formatArea(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return fmt(2, 2).format(n);
}

/** Wert für ein Eingabefeld (ohne Tausenderpunkte). */
export function toInputValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Natürliche Sortierung für Plannummern wie „A-101“, „A-99“, „B-2“. */
export const naturalCompare = new Intl.Collator('de', { numeric: true, sensitivity: 'base' }).compare;
