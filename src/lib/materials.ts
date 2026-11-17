import type { Material, MaterialItem, MaterialPlan, MaterialStatus, MaterialUse, Supplier } from './types';

/**
 * Materialverwaltung: Materialstamm und Lieferanten der Firma. Doppelte Einträge werden beim Anlegen erkannt
 * (gleiche Artikelnummer beim selben Lieferanten bzw. gleicher Name mit gleicher Einheit, Schreibweise egal).
 */

/** übliche Einheiten (frei erweiterbar) */
export const UNITS = ['Stk', 'm', 'm²', 'm³', 'kg', 't', 'l', 'Sack', 'Dose', 'Kübel', 'Eimer', 'Kanister', 'Kartusche', 'Flasche', 'Palette', 'Rolle', 'Paket', 'Karton', 'Std', 'psch'];

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
  const alias: Record<string, string> = {
    stueck: 'stk',
    st: 'stk',
    stck: 'stk',
    qm: 'm2',
    lfm: 'm',
    lm: 'm',
    kilogramm: 'kg',
    liter: 'l',
    pal: 'palette',
    paletten: 'palette',
    sck: 'sack',
    saecke: 'sack',
    dosen: 'dose',
    kuebeln: 'kuebel',
    kartuschen: 'kartusche',
    flaschen: 'flasche',
    rollen: 'rolle',
    kartons: 'karton',
    pakete: 'paket',
  };
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
export function orderText(o: {
  orderNo: string;
  company: string;
  by: string;
  items: MaterialItem[];
  articleNo: (materialId: string) => string;
  site: (projectId: string) => { name: string; address: string };
  /** Materialstamm: Paletten und Inhalt je Position (z. B. „2 Paletten + 18 Dosen, 490 kg“) */
  material?: (materialId: string) => Pick<Material, 'perPallet' | 'packSize' | 'packUnit'> | undefined;
}): string {
  const lines: string[] = [`Bestellung ${o.orderNo}${o.company ? ` – ${o.company}` : ''}`, ''];
  const bySite = new Map<string, MaterialItem[]>();
  for (const x of o.items) bySite.set(x.projectId, [...(bySite.get(x.projectId) ?? []), x]);
  for (const [pid, list] of bySite) {
    const s = o.site(pid);
    lines.push(`Baustelle: ${s.name}`);
    if (s.address) lines.push(`Lieferadresse: ${s.address}`);
    for (const x of list) {
      const art = x.materialId ? o.articleNo(x.materialId) : '';
      const m = x.materialId ? o.material?.(x.materialId) : undefined;
      const pack = [palletText(x.qty, m?.perPallet, x.unit), packText(x.qty, m)].filter(Boolean).join(', ');
      lines.push(`- ${qtyText(x.qty, x.unit)} ${x.name}${pack ? ` (${pack})` : ''}${art ? ` (Art.-Nr. ${art})` : ''}${x.deliveryDate ? ` – Liefertermin ${dayText(x.deliveryDate)}` : ''}${x.note ? ` – ${x.note}` : ''}`);
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

// ---------------------------------------------------------------------------------------------
// Bestand, Verbrauch und Bedarf je Baustelle (Teil 3)
//   Bestand:   bestellt (unterwegs), geliefert, verbraucht, vorhanden = geliefert − verbraucht
//   Verbrauch: Einträge je Tag, optional mit „dabei geschafft“ (z. B. 40 m²) → Durchschnitt je m² wird erkannt
//   Bedarf:    Gesamtmenge der Baustelle (Aufmaß, LV oder eingetippt) × Verbrauch je Bezugsgröße
//              → noch nötig, fehlt, auf Einheit bzw. ganze Paletten aufgerundet nachbestellen
// ---------------------------------------------------------------------------------------------

/** Bezugsgrößen für den Verbrauch („je m²“ …) */
export const BASES = ['m²', 'm', 'm³', 'Stk'];
/** Einheiten für den Inhalt eines Gebindes (1 Sack = 25 kg) */
export const PACK_UNITS = ['kg', 'l', 'm', 'm²', 'm³', 'Stk', 't'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Bezugsgröße vereinheitlicht: m2/qm → m², lfm → m, m3 → m³, Stück → Stk */
export function normBasis(u: string | null | undefined): string {
  const k = normUnit(u);
  return k === 'm2' ? 'm²' : k === 'm3' ? 'm³' : k === 'm' ? 'm' : k === 'stk' ? 'Stk' : (u ?? '').trim();
}

/** Material auf der Baustelle: Materialstamm-ID, sonst Bezeichnung + Einheit (frei eingegeben) */
export const materialKey = (x: { materialId?: string | null; name: string; unit: string }) => (x.materialId ? x.materialId : `f-${normKey(x.name).slice(0, 24)}-${normUnit(x.unit)}`);
/** Kennung der Bedarfsrechnung: je Baustelle und Material genau eine */
export const planId = (projectId: string, x: { materialId?: string | null; name: string; unit: string }) => `${projectId}:${materialKey(x)}`;

export interface SiteStock {
  key: string;
  materialId: string | null;
  name: string;
  unit: string;
  /** Bedarf gemeldet, noch nicht bestellt */
  open: number;
  /** bestellt, unterwegs */
  ordered: number;
  delivered: number;
  used: number;
  /** vorhanden = geliefert − verbraucht (nie unter 0) */
  onSite: number;
}

/** Bestand je Material auf einer Baustelle aus Materialliste, Verbrauch und Bedarfsrechnungen (nach Bezeichnung) */
export function siteStock(items: MaterialItem[], uses: MaterialUse[], plans: MaterialPlan[] = []): SiteStock[] {
  const map = new Map<string, SiteStock>();
  const get = (x: { materialId?: string | null; name: string; unit: string }) => {
    const key = materialKey(x);
    let s = map.get(key);
    if (!s) map.set(key, (s = { key, materialId: x.materialId ?? null, name: x.name, unit: x.unit, open: 0, ordered: 0, delivered: 0, used: 0, onSite: 0 }));
    return s;
  };
  for (const x of items) {
    const s = get(x);
    const q = x.qty ?? 0;
    if (x.status === 'offen') s.open += q;
    else if (x.status === 'bestellt') s.ordered += q;
    else s.delivered += q;
  }
  for (const u of uses) get(u).used += u.qty;
  for (const p of plans) get(p);
  return [...map.values()]
    .map((s) => ({ ...s, open: r3(s.open), ordered: r3(s.ordered), delivered: r3(s.delivered), used: r3(s.used), onSite: Math.max(0, r3(s.delivered - s.used)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.unit.localeCompare(b.unit, 'de'));
}

export interface UseAverage {
  /** Verbrauch je Bezugsgröße in der Einheit des Materials */
  rate: number;
  qty: number;
  done: number;
  /** Anzahl der Einträge */
  n: number;
}

/** Durchschnitt aus Verbrauchseinträgen mit „dabei geschafft“ in dieser Bezugsgröße (null = noch keiner) */
export function averageUse(uses: Pick<MaterialUse, 'qty' | 'done' | 'doneUnit'>[], basis: string): UseAverage | null {
  const b = normBasis(basis);
  let qty = 0;
  let done = 0;
  let n = 0;
  for (const u of uses) {
    if (!u.done || u.done <= 0 || normBasis(u.doneUnit) !== b) continue;
    qty += u.qty;
    done += u.done;
    n++;
  }
  return done > 0 ? { rate: qty / done, qty: r3(qty), done: r3(done), n } : null;
}

/** Menge in der Einheit des Materials umrechnen (rateUnit = Einheit oder Inhalt-Einheit des Gebindes); null = nicht umrechenbar */
export function toUnit(value: number, from: string | undefined, m: { unit: string; packSize?: number | null; packUnit?: string }): number | null {
  if (!from || normUnit(from) === normUnit(m.unit)) return value;
  if (m.packSize && m.packSize > 0 && m.packUnit && normUnit(from) === normUnit(m.packUnit)) return value / m.packSize;
  return null;
}

/** Richtwert aus dem Materialstamm in Einheit je Bezugsgröße (null = keiner oder andere Bezugsgröße) */
export function guideRate(m: Pick<Material, 'unit' | 'packSize' | 'packUnit' | 'usageRate' | 'usageUnit' | 'usageBasis'> | null | undefined, basis: string): number | null {
  if (!m?.usageRate || normBasis(m.usageBasis) !== normBasis(basis)) return null;
  return toUnit(m.usageRate, m.usageUnit, m);
}

export type RateSource = 'site' | 'company' | 'guide' | 'own';
export const RATE_SOURCE_TEXT: Record<RateSource, string> = { site: 'Durchschnitt dieser Baustelle', company: 'Durchschnitt aller Baustellen', guide: 'Richtwert aus dem Material', own: 'eigener Wert' };

/** Verbrauch je Bezugsgröße: eigener Wert, sonst automatisch Baustelle → alle Baustellen → Richtwert */
export function chooseRate(o: { mode: 'auto' | 'own'; own: number | null; site: UseAverage | null; company: UseAverage | null; guide: number | null }): { rate: number; source: RateSource } | null {
  if (o.mode === 'own') return o.own && o.own > 0 ? { rate: o.own, source: 'own' } : null;
  if (o.site) return { rate: o.site.rate, source: 'site' };
  if (o.company) return { rate: o.company.rate, source: 'company' };
  if (o.guide) return { rate: o.guide, source: 'guide' };
  return null;
}

/** Einheiten, die man nur ganz bestellt (Sack, Stk, Eimer …); Maß- und Gewichtseinheiten auf 0,1 */
const DECIMAL_UNITS = new Set(['m', 'm2', 'm3', 'kg', 't', 'l', 'g']);
/** auf bestellbare Menge aufrunden */
export function roundUpQty(q: number, unit: string): number {
  if (q <= 0) return 0;
  return DECIMAL_UNITS.has(normUnit(unit)) ? Math.ceil(q * 10 - 1e-9) / 10 : Math.ceil(q - 1e-9);
}

export interface NeedResult {
  /** Bedarf für die ganze Baustelle */
  need: number;
  /** noch zu verbrauchen = Bedarf − verbraucht */
  remaining: number;
  /** vorhanden + unterwegs + gemeldet */
  covered: number;
  /** fehlt noch (0 = reicht) */
  missing: number;
  /** nachbestellen (aufgerundet; mit Paletten auf ganze Paletten) */
  reorder: number;
  /** bleibt übrig, wenn alles verbraucht ist */
  surplus: number;
}

/** Bedarf, fehlende Menge und Nachbestellung aus Gesamtmenge × Verbrauch je Bezugsgröße und dem Bestand */
export function needCalc(total: number, rate: number, s: Pick<SiteStock, 'used' | 'onSite' | 'ordered' | 'open' | 'unit'>, opts: { perPallet?: number | null; pallets?: boolean } = {}): NeedResult {
  const need = r3(Math.max(0, total) * Math.max(0, rate));
  const remaining = r3(Math.max(0, need - s.used));
  const covered = r3(s.onSite + s.ordered + s.open);
  const gap = r3(remaining - covered);
  let reorder = roundUpQty(gap, s.unit);
  if (reorder > 0 && opts.pallets && opts.perPallet && opts.perPallet > 0) reorder = Math.ceil(reorder / opts.perPallet - 1e-9) * opts.perPallet;
  return { need, remaining, covered, missing: Math.max(0, gap), reorder, surplus: Math.max(0, -gap) };
}

/** Mehrzahl der Gebinde-Einheiten (Dose → Dosen …); Sack, Kübel, Eimer, Stk und Maßeinheiten bleiben gleich */
const PLURAL: Record<string, string> = { dose: 'Dosen', palette: 'Paletten', rolle: 'Rollen', karton: 'Kartons', paket: 'Pakete', kartusche: 'Kartuschen', flasche: 'Flaschen', tube: 'Tuben' };
/** Einheit passend zur Menge: 1 Dose, 2 Dosen, 0,5 Dosen */
export const unitFor = (qty: number | null | undefined, unit: string) => (qty === 1 ? unit : (PLURAL[normUnit(unit)] ?? unit));
/** Menge mit Einheit: „18 Dosen“, „1 Dose“, „2,5 kg“ */
export const qtyText = (qty: number | null | undefined, unit: string) => `${fmtQty(qty)} ${unitFor(qty, unit)}`.trim();

/** „1 Palette + 8 Sack“ bzw. „2 Paletten“ (leer ohne Angabe je Palette oder unter einer Palette) */
export function palletText(qty: number | null | undefined, perPallet: number | null | undefined, unit: string): string {
  if (!qty || !perPallet || perPallet <= 0 || qty < perPallet) return '';
  const full = Math.floor(qty / perPallet + 1e-9);
  const rest = r3(qty - full * perPallet);
  return `${full} ${full === 1 ? 'Palette' : 'Paletten'}${rest > 0 ? ` + ${qtyText(rest, unit)}` : ''}`;
}

/** Bestellmenge so, wie man sie bestellt: „2 Paletten + 18 Dosen“, unter einer Palette „18 Dosen“ */
export const orderQtyText = (qty: number | null | undefined, unit: string, m?: Pick<Material, 'perPallet'> | null) => palletText(qty, m?.perPallet, unit) || qtyText(qty, unit);
/** Paletten und Inhalt zu einer Menge: „2 Paletten + 18 Dosen · 490 kg“ (leer ohne Angaben im Material) */
export const packDetail = (qty: number | null | undefined, unit: string, m?: Pick<Material, 'perPallet' | 'packSize' | 'packUnit'> | null) => [palletText(qty, m?.perPallet, unit), packText(qty, m)].filter(Boolean).join(' · ');
/** Zusatz zur Bestellmenge: Gebinde-Anzahl (bei Paletten) und Inhalt, z. B. „98 Dosen · 490 kg“ (leer, wenn nichts dazukommt) */
export function orderQtyDetail(qty: number | null | undefined, unit: string, m?: Pick<Material, 'perPallet' | 'packSize' | 'packUnit'> | null): string {
  if (!qty) return '';
  return [palletText(qty, m?.perPallet, unit) && qtyText(qty, unit), packText(qty, m)].filter(Boolean).join(' · ');
}

/** Inhalt einer Menge: 28 Sack → „700 kg“ (leer ohne Gebinde-Angabe) */
export const packText = (qty: number | null | undefined, m: Pick<Material, 'packSize' | 'packUnit'> | null | undefined) => (m?.packSize && m.packUnit && qty && qty > 0 ? `${fmtQty(r3(qty * m.packSize))} ${m.packUnit}` : '');

/** Verbrauch je Bezugsgröße lesbar: „0,3 Sack/m²“ (bis 3 Nachkommastellen) */
export const rateText = (rate: number, unit: string, basis: string) => `${rate.toLocaleString('de-AT', { maximumFractionDigits: 3 })} ${unit}/${basis}`;

export interface SiteCalc {
  basis: string;
  /** Gesamtmenge der Baustelle (aus dem Aufmaß/LV nachgeführt, sonst eingetippt) */
  total: number | null;
  /** Bezeichnung der Aufmaß-/LV-Menge, aus der die Gesamtmenge kommt (null = eingetippt) */
  totalFrom: string | null;
  site: UseAverage | null;
  company: UseAverage | null;
  guide: number | null;
  rate: { rate: number; source: RateSource } | null;
  result: NeedResult | null;
}

/** Bezugsgröße einer Bedarfsrechnung: gespeichert, sonst Richtwert des Materials, sonst m² */
export const calcBasis = (plan: Pick<MaterialPlan, 'basis'> | null | undefined, m: Pick<Material, 'usageBasis'> | null | undefined) => normBasis(plan?.basis || m?.usageBasis || 'm²');

/** Gesamtmenge: aus der gemerkten Aufmaß-/LV-Menge (wenn es sie noch gibt und die Einheit passt), sonst die gespeicherte */
export function planTotal(plan: Pick<MaterialPlan, 'total' | 'source' | 'basis'> | null | undefined, sources: { id: string; label: string; value: number; unit: string }[]): { total: number | null; from: string | null } {
  if (!plan) return { total: null, from: null };
  const src = plan.source ? sources.find((x) => x.id === plan.source && normBasis(x.unit) === normBasis(plan.basis)) : undefined;
  return src ? { total: src.value, from: src.label } : { total: plan.total, from: null };
}

/** Alles für die Bedarfsrechnung eines Materials auf einer Baustelle (Bestand, Durchschnitte, Bedarf, Nachbestellung) */
export function siteCalc(o: { projectId: string; stock: SiteStock; plan: MaterialPlan | null; material: Material | null; uses: MaterialUse[]; sources: { id: string; label: string; value: number; unit: string }[] }): SiteCalc {
  const basis = calcBasis(o.plan, o.material);
  const same = o.uses.filter((u) => materialKey(u) === o.stock.key);
  const site = averageUse(
    same.filter((u) => u.projectId === o.projectId),
    basis,
  );
  const company = averageUse(same, basis);
  const guide = guideRate(o.material, basis);
  const m = { unit: o.stock.unit, packSize: o.material?.packSize, packUnit: o.material?.packUnit };
  const own = o.plan?.rate ? toUnit(o.plan.rate, o.plan.rateUnit, m) : null;
  const rate = chooseRate({ mode: o.plan?.rateMode ?? 'auto', own, site, company, guide });
  const { total, from } = planTotal(o.plan, o.sources);
  const result = total && rate ? needCalc(total, rate.rate, o.stock, { perPallet: o.material?.perPallet, pallets: o.plan?.pallets }) : null;
  return { basis, total, totalFrom: from, site, company, guide, rate, result };
}
