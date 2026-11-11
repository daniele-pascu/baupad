import type { Damage, MeasureKind, MeasureType } from './types';
import { formatArea, formatMeasure, round2 } from './numbers';

/**
 * Messarten des Aufmaßes (fachliche Einteilung) – unabhängig vom Arbeitsbereich.
 *
 * Die bisherige Art `kind` (Schadstelle, Fläche, Linie) bleibt in jedem Datensatz erhalten und steuert weiter
 * die bestehenden Summen; die Messart kommt als zusätzliches Feld `measureType` dazu. Ältere Messungen ohne
 * Messart werden nur zugeordnet (nichts umgerechnet): Schadstelle → Schadstelle, Fläche → Fläche bzw. Wand,
 * Linie → Länge.
 */

export interface MeasureTypeInfo {
  id: MeasureType;
  label: string;
  /** Ergebnis-Einheit (Frei: eigene Einheit) */
  unit: string;
  /** gespeicherte Art für die bestehenden Summen (und ältere App-Stände) */
  kind: MeasureKind;
  icon: string;
  hint: string;
}

export const MEASURE_TYPES: MeasureTypeInfo[] = [
  { id: 'flaeche', label: 'Fläche', unit: 'm²', kind: 'area', icon: 'rect', hint: 'Länge × Breite × Anzahl, minus Abzüge' },
  { id: 'wand', label: 'Wand', unit: 'm²', kind: 'area', icon: 'wall', hint: 'Länge × Höhe × Anzahl, minus Öffnungen; Wandstärke optional (m³)' },
  { id: 'laenge', label: 'Länge', unit: 'm', kind: 'line', icon: 'line', hint: 'Länge × Anzahl, optional von/bis' },
  { id: 'volumen', label: 'Volumen', unit: 'm³', kind: 'area', icon: 'component', hint: 'Länge × Breite × Höhe bzw. Tiefe × Anzahl' },
  { id: 'stueck', label: 'Stück', unit: 'Stk', kind: 'line', icon: 'pin', hint: 'Anzahl, Bauteil und Beschreibung' },
  { id: 'schadstelle', label: 'Schadstelle', unit: 'm²', kind: 'damage', icon: 'ellipse', hint: 'Länge × Breite × Tiefe, Schadensart, Fotos' },
  { id: 'frei', label: 'Frei', unit: '', kind: 'line', icon: 'edit', hint: 'eigene Rechnung und Einheit, z. B. 2*3,5+1,2' },
];
export const MEASURE_TYPE_IDS = MEASURE_TYPES.map((t) => t.id);
export const typeInfo = (t: MeasureType) => MEASURE_TYPES.find((x) => x.id === t)!;

/** Arbeitsbereiche (Vorgabe); die Firma kann eigene ergänzen */
export const DEFAULT_WORK_AREAS = ['Beton', 'Mauerwerk', 'Trockenbau', 'Fassade', 'Boden', 'Decke', 'Elektro', 'Sanitär', 'Abbruch', 'Sonstiges'];

/** Schadensarten zur Auswahl (frei überschreibbar) */
export const DAMAGE_TYPES = ['Abplatzung', 'Ausbruch', 'Bewehrung freiliegend', 'Durchfeuchtung', 'Hohlstelle', 'Kiesnest', 'Korrosion', 'Riss', 'Sonstiges'];

/** Einheiten für das freie Aufmaß (Vorschläge, frei überschreibbar) */
export const FREE_UNITS = ['m', 'm²', 'm³', 'Stk', 'kg', 't', 'l', 'h', 'psch'];

const isOpen = (s: Pick<Damage['shape'], 'type' | 'closed'>) => s.type === 'line' || (s.type === 'freehand' && s.closed === false);

/** Messart einer Messung: gespeichert bzw. bei älteren Einträgen aus der Art (und Form) abgeleitet */
export function typeOf(d: Pick<Damage, 'kind' | 'shape' | 'measureType'>): MeasureType {
  if (d.measureType && MEASURE_TYPE_IDS.includes(d.measureType)) return d.measureType;
  const k = d.kind ?? 'damage';
  if (k === 'damage') return 'schadstelle';
  if (k === 'line') return 'laenge';
  return isOpen(d.shape) ? 'wand' : 'flaeche';
}

/** Messart für eine neu gezeichnete Form: offene Linien → Länge (Wand-Werkzeug → Wand), sonst Fläche */
export function defaultTypeFor(shape: Pick<Damage['shape'], 'type' | 'closed'>, wall = false): MeasureType {
  if (wall) return 'wand';
  return isOpen(shape) ? 'laenge' : 'flaeche';
}

/** Anzahl (Faktor); fehlt bzw. ungültig = 1 */
export const countOf = (d: Pick<Damage, 'count'>) => (d.count && d.count > 0 ? d.count : 1);

/** Messarten mit Fläche (Länge × Breite bzw. Höhe) */
export const typeHasArea = (t: MeasureType) => t === 'flaeche' || t === 'wand' || t === 'volumen' || t === 'schadstelle';

/** Ergebnis-Einheit einer Messung (Frei: eigene Einheit) */
export function unitOf(d: Pick<Damage, 'kind' | 'shape' | 'measureType' | 'unit'>): string {
  const t = typeOf(d);
  return t === 'frei' ? (d.unit?.trim() ?? '') : typeInfo(t).unit;
}

/** Einheit vereinheitlicht (m2 → m², Stück → Stk …) für Summen getrennt nach Einheit */
export function normUnit(u: string): string {
  const x = u.trim().toLowerCase().replace(/\s|\./g, '');
  if (['m²', 'm2', 'qm'].includes(x)) return 'm²';
  if (['m³', 'm3', 'cbm'].includes(x)) return 'm³';
  if (['m', 'lfm', 'lm', 'lfdm'].includes(x)) return 'm';
  if (['stk', 'st', 'stück', 'stueck'].includes(x)) return 'Stk';
  return u.trim();
}

/**
 * Rechnung des freien Aufmaßes: Zahlen (Komma oder Punkt), + − × / und Klammern, z. B. „2*3,5+1,2“ oder
 * „(4,5+2)×2,75“. Liefert null bei ungültiger Eingabe. Kein eval – eigener kleiner Parser.
 */
export function evalFormula(text: string): number | null {
  const s = text.replace(/\s+/g, '').replace(/[×x·]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-');
  if (!s || !/^[\d.,+\-*/()]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const num = (): number | null => {
    const m = /^\d+(?:[.,]\d+)?|^[.,]\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0].replace(',', '.'));
  };
  const factor = (): number | null => {
    if (peek() === '-') {
      i++;
      const f = factor();
      return f === null ? null : -f;
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return num();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return Math.round(v * 1e6) / 1e6;
}

/** Menge einer Messung in ihrer Einheit (Fläche netto, Länge netto, Volumen, Stück, freie Menge) */
export function quantityOfMeasure(d: Pick<Damage, 'kind' | 'shape' | 'measureType' | 'count' | 'length' | 'area' | 'depth' | 'deductions' | 'qty' | 'unit'>): { value: number | null; unit: string } {
  const t = typeOf(d);
  const unit = unitOf(d);
  if (t === 'stueck') return { value: countOf(d), unit };
  if (t === 'frei') return { value: d.qty ?? null, unit };
  if (t === 'laenge') return { value: lineTotal(d), unit };
  if (t === 'volumen') return { value: d.area !== null && d.depth !== null ? round2(d.area * d.depth) : null, unit };
  return { value: d.area, unit };
}

/** Gesamtlänge einer Längenmessung: Anzahl × Länge, mit Abzügen/Zuschlägen */
export function lineTotal(d: Pick<Damage, 'count' | 'length' | 'deductions'>): number {
  const ded = (d.deductions ?? []).reduce((s, x) => s + (x.add ? 1 : -1) * x.count * x.length, 0);
  return Math.round((countOf(d) * d.length + ded) * 1e9) / 1e9;
}

/** Summen getrennt nach Einheit (m, m², m³, Stk, eigene Einheiten) – Reihenfolge wie gefunden */
export function totalsByUnit(list: Parameters<typeof quantityOfMeasure>[0][]): { unit: string; value: number }[] {
  const out = new Map<string, number>();
  for (const d of list) {
    const q = quantityOfMeasure(d);
    if (q.value === null) continue;
    const u = normUnit(q.unit) || 'ohne Einheit';
    out.set(u, Math.round(((out.get(u) ?? 0) + q.value) * 1e6) / 1e6);
  }
  return [...out].map(([unit, value]) => ({ unit, value }));
}

const f2 = (n: number) => formatMeasure(n);
const fa = (n: number) => formatArea(n);

/**
 * Rechenweg zum Nachvollziehen, z. B. „2 × 4,50 × 2,75 − 1,89 = 22,86 m²“, „3,20 × 1,10 × 0,05 = 0,18 m³“,
 * „4 Stk“, „2*3,5+1,2 = 8,20 kg“. Leer, wenn noch nichts Vollständiges eingegeben ist.
 */
export function calcPath(d: Pick<Damage, 'kind' | 'shape' | 'measureType' | 'count' | 'length' | 'width' | 'depth' | 'area' | 'deductions' | 'areaFromShape' | 'qty' | 'unit' | 'formula'>): string {
  const t = typeOf(d);
  const n = countOf(d);
  const pre = n > 1 ? `${n} × ` : '';
  const deds = d.deductions ?? [];
  if (t === 'stueck') return `${n} Stk`;
  if (t === 'frei') {
    if (d.qty === null || d.qty === undefined) return '';
    const u = d.unit?.trim() ? ` ${d.unit.trim()}` : '';
    const f = d.formula?.trim();
    return f && f.replace(',', '.') !== String(d.qty) ? `${f} = ${fa(d.qty)}${u}` : `${fa(d.qty)}${u}`;
  }
  if (t === 'laenge') {
    const dedTxt = deds.map((x) => ` ${x.add ? '+' : '−'} ${x.count > 1 ? `${x.count} × ` : ''}${f2(x.length)}`).join('');
    const total = lineTotal(d);
    return pre || dedTxt ? `${pre}${f2(d.length)}${dedTxt} = ${fa(total)} m` : `${fa(total)} m`;
  }
  if (d.area === null) return '';
  const dedSum = deds.reduce((s, x) => s + (x.add ? 1 : -1) * x.count * round2(x.length * (x.width ?? 0)), 0);
  const base = d.areaFromShape ? `${pre}${fa(Math.round(((d.area - dedSum) / n) * 100) / 100)} (aus Plan)` : d.width !== null ? `${pre}${f2(d.length)} × ${f2(d.width)}` : '';
  const dedTxt = deds.map((x) => ` ${x.add ? '+' : '−'} ${fa(Math.abs(x.count * round2(x.length * (x.width ?? 0))))}`).join('');
  const areaTxt = base ? `${base}${dedTxt} = ${fa(d.area)} m²` : `${fa(d.area)} m²`;
  if ((t === 'volumen' || t === 'schadstelle' || t === 'wand' || t === 'flaeche') && d.depth !== null) {
    const v = round2(d.area * d.depth);
    if (t === 'volumen') return base && !dedTxt ? `${base} × ${f2(d.depth)} = ${fa(v)} m³` : `${areaTxt} × ${f2(d.depth)} = ${fa(v)} m³`;
    return `${areaTxt} · × ${f2(d.depth)} = ${fa(v)} m³`;
  }
  return areaTxt;
}
