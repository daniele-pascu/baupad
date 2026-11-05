import type { Material, Supplier } from './types';

/**
 * Materialverwaltung: Materialstamm und Lieferanten der Firma. Doppelte Einträge werden beim Anlegen erkannt
 * (gleiche Artikelnummer beim selben Lieferanten bzw. gleicher Name mit gleicher Einheit, Schreibweise egal).
 */

/** übliche Einheiten (frei erweiterbar) */
export const UNITS = ['Stk', 'm', 'm²', 'm³', 'kg', 't', 'l', 'Sack', 'Palette', 'Rolle', 'Paket', 'Karton', 'Eimer', 'Std', 'psch'];

/** Vergleichsschlüssel: Kleinbuchstaben, Umlaute/ß ausgeschrieben, nur Buchstaben und Ziffern */
export function normKey(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
/** Einheit vereinheitlichen (m2 = m², Stück = Stk …) */
export function normUnit(u: string | undefined | null): string {
  const k = normKey((u ?? '').replace('²', '2').replace('³', '3'));
  const alias: Record<string, string> = { stueck: 'stk', st: 'stk', stck: 'stk', qm: 'm2', lfm: 'm', lm: 'm', kilogramm: 'kg', liter: 'l', pal: 'palette', sck: 'sack' };
  return alias[k] ?? k;
}

export type MaterialDuplicate = { material: Material; reason: 'articleNo' | 'name' };

/** Mögliche Dubletten eines (neuen bzw. geänderten) Materials im Materialstamm */
export function materialDuplicates(m: Pick<Material, 'name' | 'articleNo' | 'unit' | 'supplierId'> & { id?: string }, all: Material[]): MaterialDuplicate[] {
  const out: MaterialDuplicate[] = [];
  const art = normKey(m.articleNo);
  const name = normKey(m.name);
  const unit = normUnit(m.unit);
  for (const x of all) {
    if (x.id === m.id) continue;
    if (art && normKey(x.articleNo) === art && (x.supplierId ?? null) === (m.supplierId ?? null)) out.push({ material: x, reason: 'articleNo' });
    else if (name && normKey(x.name) === name && normUnit(x.unit) === unit) out.push({ material: x, reason: 'name' });
  }
  return out;
}

/** Mögliche Dubletten eines Lieferanten (gleicher Name, Schreibweise und Rechtsform-Zusatz egal) */
export function supplierDuplicates(s: Pick<Supplier, 'name'> & { id?: string }, all: Supplier[]): Supplier[] {
  const strip = (n: string) => normKey(n.replace(/\b(gmbh|ges\.?m\.?b\.?h\.?|ag|kg|og|e\.?u\.?|co\.?|&|und)\b/gi, ''));
  const k = strip(s.name);
  return k ? all.filter((x) => x.id !== s.id && strip(x.name) === k) : [];
}

export const sortMaterials = (list: Material[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'de') || (a.articleNo ?? '').localeCompare(b.articleNo ?? '', 'de'));
export const sortSuppliers = (list: Supplier[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));

/** Preis „12,50 €“ bzw. leer */
export const fmtPrice = (p: number | null | undefined) => (p === null || p === undefined ? '' : `${p.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
/** Eingabe „12,5“ / „12.50 €“ → Zahl; leer → null; ungültig → undefined */
export function parsePrice(s: string): number | null | undefined {
  const t = s.replace(/€/g, '').replace(/\s/g, '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

/** Suche über Name, Artikelnummer, Kategorie und Lieferant */
export function matchesMaterial(m: Material, q: string, supplierName = ''): boolean {
  const k = normKey(q);
  if (!k) return true;
  return [m.name, m.articleNo, m.category, supplierName].some((v) => normKey(v).includes(k));
}
