import type { Material, MaterialItem, MaterialStatus, Supplier } from './types';

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

/* ───────────── Materiallisten je Baustelle (Teil 2) ───────────── */

export const STATUS: { id: MaterialStatus; label: string; next?: MaterialStatus; action?: string }[] = [
  { id: 'offen', label: 'Offen', next: 'bestellt', action: 'Bestellt' },
  { id: 'bestellt', label: 'Bestellt', next: 'geliefert', action: 'Geliefert' },
  { id: 'geliefert', label: 'Geliefert' },
];
export const statusLabel = (s: MaterialStatus) => STATUS.find((x) => x.id === s)?.label ?? s;

/** Verlaufseintrag anhängen (höchstens 30 behalten) */
export function withHistory(item: MaterialItem, by: string, text: string, at = Date.now()): MaterialItem {
  return { ...item, updatedAt: at, history: [...(item.history ?? []), { at, by, text }].slice(-30) };
}

/** Status ändern – mit Verlauf („bestellt von …“) */
export function setStatus(item: MaterialItem, status: MaterialStatus, by: string, at = Date.now()): MaterialItem {
  if (item.status === status) return item;
  return withHistory({ ...item, status }, by, `${statusLabel(status)}`, at);
}

/** Menge „1.234,5“ / „20“ → Zahl; leer → null; ungültig → undefined */
export function parseQty(s: string): number | null | undefined {
  const t = s.replace(/\s/g, '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : undefined;
}
export const fmtQty = (q: number | null | undefined) => (q === null || q === undefined ? '' : q.toLocaleString('de-AT', { maximumFractionDigits: 3 }));

/** Wert einer Position (Menge × Preis), null wenn eines fehlt */
export const itemValue = (x: Pick<MaterialItem, 'qty' | 'price'>) => (x.qty !== null && x.qty !== undefined && x.price !== null && x.price !== undefined ? Math.round(x.qty * x.price * 100) / 100 : null);

/** Zähler je Status und Summe (ohne Positionen ohne Preis) */
export function listSummary(items: MaterialItem[]) {
  const count = { offen: 0, bestellt: 0, geliefert: 0 } as Record<MaterialStatus, number>;
  let value = 0;
  for (const x of items) {
    count[x.status]++;
    value += itemValue(x) ?? 0;
  }
  return { count, value: Math.round(value * 100) / 100, total: items.length };
}

/** Dasselbe Material ist auf dieser Baustelle schon offen bzw. bestellt (noch nicht geliefert)? */
export function pendingDuplicate(items: MaterialItem[], x: Pick<MaterialItem, 'materialId' | 'name' | 'unit'> & { id?: string }): MaterialItem | null {
  return (
    items.find(
      (i) => i.id !== x.id && i.status !== 'geliefert' && (x.materialId ? i.materialId === x.materialId : normKey(i.name) === normKey(x.name) && normUnit(i.unit) === normUnit(x.unit)),
    ) ?? null
  );
}

/** Liefertermin überschritten (noch nicht geliefert) */
export const overdue = (x: Pick<MaterialItem, 'deliveryDate' | 'status'>, today: string) => !!x.deliveryDate && x.status !== 'geliefert' && x.deliveryDate < today;

// ---------------------------------------------------------------------------------------------
// Übersicht, Bestellungen über alle Baustellen, Geräte
// ---------------------------------------------------------------------------------------------

/** Gerät/Werkzeug (einzeln geführt) statt Material */
export const isEquipment = (m: Pick<Material, 'kind'>) => m.kind === 'geraet';

/** Bestellen dürfen Admin, Büro und Polier – Arbeiter melden nur Bedarf */
export const canOrder = (s: { companyId?: string | null; operator?: boolean; role?: string } | null | undefined) => !s || !s.companyId || !!s.operator || s.role === 'admin' || s.role === 'buero' || s.role === 'polier';

/** Nächste Bestellnummer des Jahres: B-2026-001, B-2026-002 … */
export function nextOrderNo(items: Pick<MaterialItem, 'orderNo'>[], year: number): string {
  const prefix = `B-${year}-`;
  let max = 0;
  for (const x of items) if (x.orderNo?.startsWith(prefix)) max = Math.max(max, Number(x.orderNo.slice(prefix.length)) || 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export interface SupplierGroup {
  /** '' = ohne Lieferant */
  supplierId: string;
  items: MaterialItem[];
}

/** Offener Bedarf je Lieferant (ohne Lieferant zuletzt), Positionen nach Liefertermin */
export function openBySupplier(items: MaterialItem[], supplierName: (id: string) => string): SupplierGroup[] {
  const map = new Map<string, MaterialItem[]>();
  for (const x of items) {
    if (x.status !== 'offen') continue;
    const k = x.supplierId ?? '';
    map.set(k, [...(map.get(k) ?? []), x]);
  }
  return [...map.entries()]
    .map(([supplierId, list]) => ({ supplierId, items: list.sort((a, b) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999') || a.name.localeCompare(b.name, 'de')) }))
    .sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || supplierName(a.supplierId).localeCompare(supplierName(b.supplierId), 'de'));
}

export interface OrderGroup {
  /** Bestellnummer; '' = ohne Nummer (einzeln als bestellt markiert) */
  orderNo: string;
  supplierId: string;
  items: MaterialItem[];
  /** frühester Liefertermin der Bestellung */
  due: string;
}

/** Bestellungen unterwegs: je Bestellnummer (ohne Nummer je Lieferant), früheste Lieferung zuerst */
export function ordersInTransit(items: MaterialItem[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  for (const x of items) {
    if (x.status !== 'bestellt') continue;
    const k = x.orderNo ? `n:${x.orderNo}` : `s:${x.supplierId ?? ''}`;
    const g = map.get(k) ?? { orderNo: x.orderNo ?? '', supplierId: x.supplierId ?? '', items: [], due: '' };
    g.items.push(x);
    if (x.deliveryDate && (!g.due || x.deliveryDate < g.due)) g.due = x.deliveryDate;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.orderNo.localeCompare(b.orderNo));
}

const dayText = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Text einer Bestellung (für E-Mail oder zum Kopieren): Positionen je Baustelle mit Lieferadresse und Termin */
export function orderText(o: { orderNo: string; company: string; by: string; items: MaterialItem[]; articleNo: (materialId: string) => string; site: (projectId: string) => { name: string; address: string } }): string {
  const lines: string[] = [`Bestellung ${o.orderNo}${o.company ? ` – ${o.company}` : ''}`, ''];
  const bySite = new Map<string, MaterialItem[]>();
  for (const x of o.items) bySite.set(x.projectId, [...(bySite.get(x.projectId) ?? []), x]);
  for (const [pid, list] of bySite) {
    const s = o.site(pid);
    lines.push(`Baustelle: ${s.name}`);
    if (s.address) lines.push(`Lieferadresse: ${s.address}`);
    for (const x of list) {
      const art = x.materialId ? o.articleNo(x.materialId) : '';
      lines.push(`- ${fmtQty(x.qty)} ${x.unit} ${x.name}${art ? ` (Art.-Nr. ${art})` : ''}${x.deliveryDate ? ` – Liefertermin ${dayText(x.deliveryDate)}` : ''}${x.note ? ` – ${x.note}` : ''}`);
    }
    lines.push('');
  }
  lines.push('Bitte um Auftragsbestätigung mit Liefertermin.', '', `Freundliche Grüße${o.by ? `\n${o.by}` : ''}`);
  return lines.join('\n');
}

/** Positionen als bestellt markieren – mit Bestellnummer und Verlauf */
export function markOrdered(items: MaterialItem[], orderNo: string, by: string, at = Date.now()): MaterialItem[] {
  return items.map((x) => withHistory({ ...x, status: 'bestellt' as MaterialStatus, orderNo, orderedAt: at }, by, `Bestellt (${orderNo})`, at));
}

/** Gerät: Stück auf Baustellen (Summe aller Standorte) */
export const equipmentOut = (m: Pick<Material, 'places'>) => (m.places ?? []).reduce((n, p) => n + (p.qty > 0 ? p.qty : 0), 0);
/** Gerät: Stück im Lager (gesamt minus auf Baustellen, nie negativ) */
export const equipmentInStock = (m: Pick<Material, 'places' | 'total'>) => Math.max(0, (m.total ?? 0) - equipmentOut(m));
/** Gerät: Stück auf einer bestimmten Baustelle */
export const equipmentAt = (m: Pick<Material, 'places'>, siteId: string) => (m.places ?? []).find((p) => p.siteId === siteId)?.qty ?? 0;

/** Stückzahl eines Geräts auf einer Baustelle setzen (0 = alle zurück im Lager) – mit Verlauf */
export function placeEquipment(m: Material, siteId: string, qty: number, siteName: string, by: string, at = Date.now()): Material {
  const before = equipmentAt(m, siteId);
  const n = Math.max(0, Math.round(qty));
  if (before === n) return m;
  const places = [...(m.places ?? []).filter((p) => p.siteId !== siteId), ...(n > 0 ? [{ siteId, qty: n }] : [])];
  return { ...m, places, updatedAt: at, log: [...(m.log ?? []), { at, by, text: `${siteName}: ${before} → ${n} Stk` }].slice(-40) };
}

/** Kennzahlen der Übersicht: offener Bedarf, unterwegs, überfällig, Geräte-Stück auf Baustellen */
export function overviewCounts(items: MaterialItem[], equipment: Material[], today: string) {
  let open = 0;
  let ordered = 0;
  let late = 0;
  for (const x of items) {
    if (x.status === 'offen') open++;
    if (x.status === 'bestellt') ordered++;
    if (overdue(x, today)) late++;
  }
  const out = equipment.reduce((n, m) => n + equipmentOut(m), 0);
  return { open, ordered, late, out };
}
