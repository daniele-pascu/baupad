import { countOf, typeOf } from './measure-types';
import { alive, type ProjectState } from './store';
import type { Damage, LvDocument, LvPosition, PosRule } from './types';

/**
 * Schadstellen-Positionen eines LV: Positionen, die nach Größe je Schadstelle (m²), nach Tiefe (mm) oder als
 * Zulage „je weitere 10 mm“ ausgeschrieben sind. Die Regel wird aus dem Positionstext vorgeschlagen
 * (`detectRule`), vom Benutzer einmal bestätigt und danach auf jede Schadstelle angewendet (`autoBookings`):
 * die Schadstelle zählt dann von selbst bei allen Positionen, deren Regel zu ihrer Fläche und Tiefe passt.
 */

const NUM = '(\\d+(?:[.,]\\d+)?)';
const toNum = (s: string) => Number(s.replace(',', '.'));
/** Wörter vor einer Maßangabe, die kein Tiefenmaß meinen (Höhe eines Streifens, Durchmesser, Körnung …) */
const NOT_DEPTH = /(höhe|hoehe|hoch|breite|breit|streifen|länge|laenge|lang|durchmesser|ø|körnung|koernung|korn|überdeckung|abstand|stabdurchmesser|bewehrung)\W{0,3}(?:von\s*|bis\s*zu\s*)?$/;
/** Text deutet auf eine Tiefe hin (Abtrag, Ausbruch, Schadstelle …) */
const DEPTH_CUE = /(tief|abtrag|ausbruch|stemm|reprofil|schadstelle|betonersatz|instandsetz|fehlstelle|abplatz)/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/m\s?2\b|qm\b/g, 'm²')
    .replace(/[ \s]+/g, ' ')
    .replace(/≤|<=/g, 'bis ')
    .replace(/≥|>=|>/g, 'über ');
}

/** Regel aus dem Text einer Position vorschlagen (null = nichts erkannt). */
export function detectRule(pos: Pick<LvPosition, 'shortText' | 'longText'>): PosRule | null {
  const text = normalize(`${pos.shortText}\n${pos.longText ?? ''}`);
  const rule: PosRule = {};

  // Größe je Schadstelle in m²
  const aRange = new RegExp(`(?:über|ueber|von|größer(?: als)?|groesser(?: als)?|mehr als)\\s*${NUM}\\s*(?:m²)?\\s*(?:bis|-|–)\\s*(?:zu\\s*)?${NUM}\\s*m²`).exec(text);
  if (aRange) {
    rule.areaFrom = toNum(aRange[1]);
    rule.areaTo = toNum(aRange[2]);
  } else {
    const aTo = new RegExp(`bis\\s*(?:zu\\s*)?${NUM}\\s*m²`).exec(text);
    const aFrom = new RegExp(`(?:über|ueber|größer(?: als)?|groesser(?: als)?|mehr als|ab)\\s*${NUM}\\s*m²`).exec(text);
    if (aTo) rule.areaTo = toNum(aTo[1]);
    else if (aFrom) rule.areaFrom = toNum(aFrom[1]);
  }

  // Zulage: „je weitere 10 mm“, „je weiterem cm“, „je angefangene 10 mm“
  const step = new RegExp(`je\\s+(?:weiter\\w*|zusätzlich\\w*|zusaetzlich\\w*|angefangen\\w*)\\s*(?:angefangen\\w*\\s*)?${NUM}?\\s*(mm|cm)`).exec(text);
  if (step) rule.stepMm = (step[1] ? toNum(step[1]) : 1) * (step[2] === 'cm' ? 10 : 1);

  // Tiefe in mm (cm wird umgerechnet); nur wenn der Text von einer Tiefe handelt
  if (DEPTH_CUE.test(text) || step) {
    const mm = (v: string, unit: string) => toNum(v) * (unit === 'cm' ? 10 : 1);
    const ok = (m: RegExpExecArray) => !NOT_DEPTH.test(text.slice(Math.max(0, m.index - 30), m.index)) && !(step && m.index >= step.index && m.index < step.index + step[0].length);
    const all = (re: RegExp) => [...text.matchAll(re)].filter((m) => ok(m as RegExpExecArray));
    const dRange = all(new RegExp(`(?:über|ueber|von|größer(?: als)?|mehr als)\\s*${NUM}\\s*(?:mm|cm)?\\s*(?:bis|-|–)\\s*(?:zu\\s*)?${NUM}\\s*(mm|cm)`, 'g'))[0];
    const dTo = all(new RegExp(`bis\\s*(?:zu\\s*)?${NUM}\\s*(mm|cm)`, 'g'))[0];
    const dFrom = all(new RegExp(`(?:über|ueber|größer(?: als)?|mehr als|ab)\\s*${NUM}\\s*(mm|cm)`, 'g'))[0];
    if (step) {
      // Zulage: ab welcher Tiefe sie beginnt, steht im Text („über 40 mm“) oder ergibt sich aus der größten Tiefenposition
      if (dFrom) rule.stepFrom = mm(dFrom[1], dFrom[2]);
      else if (dRange) rule.stepFrom = mm(dRange[2], dRange[3]);
    } else if (dRange) {
      rule.depthFrom = mm(dRange[1], dRange[3]);
      rule.depthTo = mm(dRange[2], dRange[3]);
    } else if (dTo) rule.depthTo = mm(dTo[1], dTo[2]);
    else if (dFrom) rule.depthFrom = mm(dFrom[1], dFrom[2]);
  }
  return hasRule(rule) ? rule : null;
}

/** Regel enthält mindestens eine Angabe */
export const hasRule = (r: PosRule | null | undefined): r is PosRule =>
  !!r && [r.areaFrom, r.areaTo, r.depthFrom, r.depthTo, r.stepMm].some((v) => v !== null && v !== undefined);

const de = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
const range = (from: number | null | undefined, to: number | null | undefined, unit: string) =>
  from != null && to != null ? `über ${de(from)} bis ${de(to)} ${unit}` : to != null ? `bis ${de(to)} ${unit}` : from != null ? `über ${de(from)} ${unit}` : '';

/** Regel in Worten, z. B. „über 0,25 bis 1,5 m² · Tiefe bis 40 mm“ oder „je weitere 10 mm ab 60 mm“ */
export function ruleText(r: PosRule, stepFrom?: number | null): string {
  const parts: string[] = [];
  const a = range(r.areaFrom, r.areaTo, 'm²');
  if (a) parts.push(`Größe ${a}`);
  const d = range(r.depthFrom, r.depthTo, 'mm');
  if (d) parts.push(`Tiefe ${d}`);
  if (r.stepMm) {
    const from = r.stepFrom ?? stepFrom ?? null;
    parts.push(`je weitere ${de(r.stepMm)} mm${from != null ? ` ab ${de(from)} mm` : ' ab der größten Tiefenposition'}`);
  }
  return parts.join(' · ');
}

const EPS = 1e-6;

/**
 * Wie oft eine Schadstelle bei einer Position mit dieser Regel zählt: 0 = gar nicht, 1 = einmal (Klasse passt),
 * n = Anzahl der Stufen einer Zulage (jede angefangene Stufe zählt: 1 mm über der Grenze ist schon die nächste).
 * `maxDepthTo`: größte Tiefenklasse der zugehörigen Positionen (Beginn der Zulage, wenn die Regel keinen nennt).
 */
export function ruleFactor(r: PosRule, d: Pick<Damage, 'area' | 'depth' | 'count'>, maxDepthTo: number | null = null): number {
  if (!hasRule(r)) return 0;
  if (r.areaFrom != null || r.areaTo != null) {
    if (d.area === null) return 0;
    const a = d.area / countOf(d); // Größe je einzelner Schadstelle
    if (r.areaFrom != null && !(a > r.areaFrom + EPS)) return 0;
    if (r.areaTo != null && !(a <= r.areaTo + EPS)) return 0;
  }
  const depthMm = d.depth === null || d.depth === undefined ? null : Math.round(d.depth * 1000 * 1000) / 1000;
  if (r.depthFrom != null || r.depthTo != null) {
    if (depthMm === null) return 0;
    if (r.depthFrom != null && !(depthMm > r.depthFrom + EPS)) return 0;
    if (r.depthTo != null && !(depthMm <= r.depthTo + EPS)) return 0;
  }
  if (r.stepMm) {
    const from = r.stepFrom ?? maxDepthTo;
    if (depthMm === null || from === null || from === undefined) return 0;
    const over = depthMm - from;
    return over > EPS ? Math.ceil(over / r.stepMm - EPS) : 0;
  }
  return 1;
}

/** Bestätigte Regel einer Position (nur sie wird angewendet) */
export const activeRule = (p: Pick<LvPosition, 'rule'>): PosRule | null => (p.rule && p.rule.confirmed && hasRule(p.rule) ? p.rule : null);

/** Vorschlag für eine noch nie geprüfte Position (`rule` fehlt); geprüfte Positionen haben eine Regel oder `null` */
export const suggestedRule = (p: LvPosition): PosRule | null => (p.rule === undefined ? detectRule(p) : null);

/** Beginn der Zulage: größte Tiefenklasse der bestätigten Positionen derselben Gruppe, sonst des ganzen LV */
export function stepStart(doc: Pick<LvDocument, 'positions'>, pos: Pick<LvPosition, 'group'>): number | null {
  const max = (list: LvPosition[]) => {
    const v = list.map((p) => activeRule(p)?.depthTo).filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  };
  return max(doc.positions.filter((p) => p.group === pos.group)) ?? max(doc.positions);
}

/**
 * Die größte Tiefenklasse gilt auch für tiefere Schadstellen (Grundposition; das Mehr an Tiefe rechnet die
 * Zulage „je weitere … mm“ ab) – außer das LV hat selbst eine nach oben offene Klasse („über 60 mm“).
 */
function openTop(doc: Pick<LvDocument, 'positions'>, pos: Pick<LvPosition, 'group'>, r: PosRule): PosRule {
  if (r.stepMm || r.depthTo == null) return r;
  const same = doc.positions.filter((p) => p.group === pos.group);
  const rules = (same.some((p) => activeRule(p)?.depthTo != null) ? same : doc.positions).map(activeRule).filter((x): x is PosRule => !!x && !x.stepMm);
  const max = Math.max(...rules.map((x) => x.depthTo ?? -Infinity));
  const open = rules.some((x) => x.depthFrom != null && x.depthTo == null);
  return r.depthTo === max && !open ? { ...r, depthTo: null, depthFrom: r.depthFrom ?? null, ...(r.depthFrom == null ? { depthFrom: -1 } : {}) } : r;
}

export interface Booking {
  /** Verweis „Dokument:Position“ */
  ref: string;
  /** 1 = einmal, n = Stufen einer Zulage */
  factor: number;
}

const lvDocs = (data: ProjectState) => alive(data.lvDocs ?? {});

/** Alle Positionen, bei denen diese Schadstelle automatisch zählt (bestätigte Regeln, ohne die abgewählten). */
export function autoBookings(data: Pick<ProjectState, 'lvDocs'>, d: Damage): Booking[] {
  if (typeOf(d) !== 'schadstelle') return [];
  const off = new Set(d.autoOff ?? []);
  const out: Booking[] = [];
  for (const doc of lvDocs(data as ProjectState))
    for (const p of doc.positions) {
      const r = activeRule(p);
      if (!r) continue;
      const ref = `${doc.id}:${p.id}`;
      if (off.has(ref)) continue;
      const factor = ruleFactor(openTop(doc, p, r), d, stepStart(doc, p));
      if (factor > 0) out.push({ ref, factor });
    }
  return out;
}

/** Faktor, mit dem eine Messung bei einer Position zählt: von Hand zugeordnet (1) bzw. automatisch (Regel); 0 = gar nicht */
export function bookingFactor(data: Pick<ProjectState, 'lvDocs'>, d: Damage, ref: string): number {
  const auto = autoBookings(data, d).find((b) => b.ref === ref);
  if (auto) return auto.factor;
  return d.positionRef === ref ? 1 : 0;
}

/** Zählt die Messung bei irgendeiner Position (von Hand oder automatisch)? */
export const isBooked = (data: Pick<ProjectState, 'lvDocs'>, d: Damage, exists: (ref: string) => boolean): boolean =>
  (!!d.positionRef && exists(d.positionRef)) || autoBookings(data, d).length > 0;

/** Messungen, die bei einer Position zählen – von Hand zugeordnet oder automatisch über die Regel – mit ihrem Faktor */
export function bookedForPosition(data: ProjectState, ref: string): { d: Damage; factor: number; auto: boolean }[] {
  const livePlans = new Set(alive(data.plans).map((p) => p.id));
  const out: { d: Damage; factor: number; auto: boolean }[] = [];
  for (const d of alive(data.damages)) {
    if (!livePlans.has(d.planId)) continue;
    const factor = bookingFactor(data, d, ref);
    if (factor > 0) out.push({ d, factor, auto: d.positionRef !== ref });
  }
  return out;
}
