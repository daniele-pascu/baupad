import { costCenterLabel } from './aufmass';
import { absenceOn } from './crew-absence';
import { addDays, carryOver, countByGrade, gradeOf, isoDate, parseDate, weekOf, workerName } from './crew';
import { uuid } from './ids';
import type { Absence, CostCenter, DailyData, Project, RegieData, Report, ReportHead, ReportItem, ReportType, ReportWorker, StaffCount, WeekPlan, WeeklyData, Worker } from './types';

/**
 * Berichte & Formulare: gemeinsame Grundlage aller Berichtstypen (Kopfdaten, Arbeiterübernahme, Nummern,
 * Gruppierung). Jeder Typ ist im Register `REPORT_TYPES` beschrieben – ein weiteres Formular wird dort ergänzt.
 * Übernommene Daten werden als Kopie gespeichert: spätere Änderungen an Projekt oder Arbeitern ändern
 * gespeicherte Berichte nicht.
 */

export interface ReportTypeInfo {
  type: ReportType;
  /** Bezeichnung (Einzahl / Mehrzahl) und Kurzform für die Liste */
  label: string;
  plural: string;
  short: string;
  /** Zeitraum: ein Tag oder eine Woche (Mo–So) */
  period: 'day' | 'week';
}

export const REPORT_TYPES: ReportTypeInfo[] = [
  { type: 'regie', label: 'Regieliste', plural: 'Regielisten', short: 'Regie', period: 'day' },
  { type: 'tag', label: 'Bautagesbericht', plural: 'Bautagesberichte', short: 'Tagesbericht', period: 'day' },
  { type: 'woche', label: 'Bauwochenbericht', plural: 'Bauwochenberichte', short: 'Wochenbericht', period: 'week' },
];

export const typeInfo = (t: ReportType) => REPORT_TYPES.find((x) => x.type === t)!;

export const emptyHead = (): ReportHead => ({ project: '', number: '', site: '', address: '', client: '', costCenter: '', responsible: '' });

/** Kopfdaten aus einem Projekt (Aufmaß & Abrechnung) */
export function headFromProject(p: Pick<Project, 'name' | 'number' | 'site' | 'address' | 'client' | 'editor'>, costCenters: Pick<CostCenter, 'number' | 'name'>[] = []): ReportHead {
  return {
    project: p.name,
    number: p.number ?? '',
    site: p.site || p.name,
    address: p.address,
    client: p.client,
    costCenter: costCenters.map((c) => costCenterLabel(c)).filter(Boolean).join(', '),
    responsible: p.editor,
  };
}

/** Schlüssel der Baustelle (Gruppierung): Projekt bzw. Name der frei eingegebenen Baustelle */
export const siteKey = (r: Pick<Report, 'projectId' | 'head'>) => (r.projectId ? `p:${r.projectId}` : `n:${(r.head.site || r.head.project).trim().toLowerCase()}`);
export const siteLabel = (r: Pick<Report, 'head'>) => r.head.site || r.head.project || 'Ohne Baustelle';

export const emptyRegie = (): RegieData => ({ workers: [], work: '', materials: [], equipment: [], notes: '', overtime: false });
export const emptyDaily = (): DailyData => ({ from: '', to: '', weather: '', tempMin: '', tempMax: '', crew: [], crewCount: null, work: '', materials: [], equipment: [], incidents: '', notes: '' });
const emptyWeekly = (monday: string): WeeklyData => ({
  days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: addDays(monday, d), count: null, names: '', work: '' })),
  events: '',
  notes: '',
  open: '',
});

/** Nächste Nummer je Baustelle und Typ (höchste Zahl + 1) */
export function nextNo(all: Report[], type: ReportType, key: string): string {
  const max = all.filter((r) => r.type === type && siteKey(r) === key).reduce((m, r) => Math.max(m, parseInt(r.no, 10) || 0), 0);
  return String(max + 1);
}

/** Neuer Bericht (Wochenbericht: Woche des Datums, Montag bis Sonntag) */
export function newReport(type: ReportType, opts: { projectId: string | null; head: ReportHead; date: string; all: Report[] }): Report {
  const now = Date.now();
  const base = { id: uuid(), projectId: opts.projectId, head: { ...opts.head }, status: 'draft' as const, createdAt: now, updatedAt: now };
  const key = siteKey({ projectId: opts.projectId, head: opts.head });
  const no = nextNo(opts.all, type, key);
  if (type === 'woche') {
    const monday = weekOf(opts.date);
    return { ...base, type, no, date: monday, dateTo: addDays(monday, 6), data: emptyWeekly(monday) };
  }
  if (type === 'tag') return { ...base, type, no, date: opts.date, data: emptyDaily() };
  return { ...base, type, no, date: opts.date, data: emptyRegie() };
}

/** Kopie als neuer Bericht (Entwurf, neue Nummer, gewähltes Datum) */
export function copyReport(r: Report, date: string, all: Report[]): Report {
  const fresh = newReport(r.type, { projectId: r.projectId, head: r.head, date, all });
  const data = structuredClone(r.data) as Report['data'];
  // Wochenbericht: Tage auf die neue Woche verschieben
  if (fresh.type === 'woche' && r.type === 'woche') (data as WeeklyData).days = (data as WeeklyData).days.map((d, i) => ({ ...d, date: addDays(fresh.date, i) }));
  return { ...fresh, data } as Report;
}

export const newItem = (): ReportItem => ({ id: uuid(), text: '', qty: null, unit: '' });

export function workerRow(w?: Pick<Worker, 'id' | 'firstName' | 'lastName' | 'role' | 'grade'>, extra: Partial<ReportWorker> = {}): ReportWorker {
  return { id: uuid(), workerId: w?.id, name: w ? workerName(w) : '', role: w?.role ?? '', grade: w ? gradeOf(w) : undefined, from: '', to: '', pause: '', hours: null, ...extra };
}

/** Personalstand aus der Mannschaft des Tages (anwesend bzw. noch nicht abgewählt) */
export function staffFromCrew(crew: ReportWorker[]): StaffCount {
  const counted = crew.filter((w) => w.present !== false && (w.name.trim() || w.workerId));
  const c = countByGrade(counted);
  return { bauleiter: c.bauleiter || null, vorarbeiter: c.vorarbeiter || null, facharbeiter: c.facharbeiter || null, hilfsarbeiter: c.hilfsarbeiter || null, lehrling: c.lehrling || null };
}

/** Personalstand gesetzt? (mindestens eine Zahl) */
export const hasStaff = (s: StaffCount | undefined) => !!s && Object.values(s).some((v) => v !== null && v !== undefined);

/** Summe des Personalstands */
export const staffTotal = (s: StaffCount | undefined) => (s ? Object.values(s).reduce<number>((a, v) => a + (v ?? 0), 0) : 0);

/** „07:00“ → Minuten; ungültig → null */
const minutes = (t: string) => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(t.trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};

/**
 * Stunden aus Beginn, Ende und Pause (Minuten) – nur wenn Beginn und Ende gültig sind (über Mitternacht möglich).
 * Fehlt etwas, wird nichts berechnet (null).
 */
export function hoursFromTimes(from: string, to: string, pause: string): number | null {
  const a = minutes(from);
  const b = minutes(to);
  if (a === null || b === null) return null;
  const p = pause.trim() ? Number(pause.replace(',', '.')) : 0;
  if (!Number.isFinite(p) || p < 0) return null;
  const span = (b - a + 1440) % 1440;
  const h = (span - p) / 60;
  return h > 0 ? Math.round(h * 100) / 100 : null;
}

/** Stunden eines Arbeiters: von Hand eingetragen, sonst aus Beginn/Ende/Pause */
export const workerHours = (w: Pick<ReportWorker, 'hours' | 'from' | 'to' | 'pause'>) => w.hours ?? hoursFromTimes(w.from, w.to, w.pause);

/** Summe der Stunden – nur aus vorhandenen Angaben; ohne Angaben null (nichts erfunden) */
export function sumHours(list: Pick<ReportWorker, 'hours' | 'from' | 'to' | 'pause'>[]): number | null {
  const hs = list.map(workerHours).filter((h): h is number => h !== null);
  return hs.length ? Math.round(hs.reduce((s, h) => s + h, 0) * 100) / 100 : null;
}

export interface CrewSuggestion {
  worker: Worker;
  /** Urlaub bzw. krank laut Arbeitereinteilung */
  absence: 'urlaub' | 'krank' | null;
}

/** Woche wie in der Arbeitereinteilung: gespeichert oder aus der Vorwoche weitergeführt */
export function effectiveWeek(weekId: string, saved: WeekPlan | undefined, previous: WeekPlan | undefined): WeekPlan | null {
  if (saved) return saved;
  return previous ? carryOver(previous, weekId) : null;
}

/**
 * Eingeteilte Arbeiter einer Baustelle an einem Tag (Vorschlag, keine Pflicht): Baustelle über das Projekt
 * bzw. den Namen; Urlaub und Krank werden gekennzeichnet.
 */
export function crewForDay(week: WeekPlan | null, date: string, site: { projectId: string | null; name: string }, workers: Worker[], absences: Absence[]): CrewSuggestion[] {
  if (!week) return [];
  const day = (parseDate(date).getDay() + 6) % 7;
  const name = site.name.trim().toLowerCase();
  const s = week.sites.find((x) => (site.projectId && x.projectId ? x.projectId === site.projectId : x.name.trim().toLowerCase() === name));
  if (!s) return [];
  const byId = new Map(workers.map((w) => [w.id, w]));
  return s.days[day]
    .map((id) => byId.get(id))
    .filter((w): w is Worker => !!w)
    .map((w) => ({ worker: w, absence: absenceOn(absences, w.id, week.id, day) }));
}

/** Datum lesbar, z. B. „Mi, 28.10.2026“ */
export function fmtDate(d: string, weekday = true): string {
  if (!d) return '';
  const x = parseDate(d);
  return x.toLocaleDateString('de-DE', { ...(weekday ? { weekday: 'short' } : {}), day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Zeitraum eines Berichts für Liste und PDF */
export const periodLabel = (r: Pick<Report, 'date' | 'dateTo'>) => (r.dateTo ? `${fmtDate(r.date, false)} – ${fmtDate(r.dateTo, false)}` : fmtDate(r.date));

export const today = () => isoDate(new Date());

/** Stunden deutsch: 8,5 */
export const fmtHours = (h: number | null) => (h === null ? '' : h.toLocaleString('de-DE', { maximumFractionDigits: 2 }));
