import { safeFileName, type ExportFile } from './aufmass';
import { addDays, isoDate, parseDate, weekOf, workerName } from './crew';
import { blank, buildXlsx, num, str, type Cell, type Sheet } from './xlsx';
import type { Absence, WeekPlan, Worker, WorkTimes } from './types';

/**
 * Zeitaufzeichnung: Der Polier tippt für jeden Arbeiter je Tag Baustelle und Stunden (Wegzeit optional).
 * Vorschlag aus der Arbeitereinteilung (Baustelle) und der Firmen-Arbeitszeit (Stunden) – gezählt wird nur,
 * was bestätigt ist. Monatszettel je Person, Freigabe durch das Büro, Excel für die Lohnverrechnung.
 */

export interface TimeLine {
  projectId: string | null;
  siteName: string;
  /** Stunden (Dezimal, z. B. 8,5) */
  hours: number;
  /** Wegzeit in Stunden (optional) */
  travel?: number;
}

/** erfasster Tag eines Arbeiters (Datensatz je Arbeiter und Tag – zwei Poliere stören sich nicht) */
export interface TimeDay {
  id: string;
  workerId: string;
  date: string;
  /** JJJJ-MM */
  month: string;
  /** leer = Tag ohne Stunden (bewusst bestätigt) */
  lines: TimeLine[];
  updatedAt: number;
  updatedBy: string;
  /** Änderungen nach der Freigabe */
  log?: { at: number; by: string; text: string }[];
}

/** Freigabe eines Monats je Arbeiter durch das Büro */
export interface TimeMonth {
  id: string;
  workerId: string;
  month: string;
  approvedAt: number;
  approvedBy: string;
}

export const dayId = (workerId: string, date: string) => `${workerId}|${date}`;
export const monthId = (workerId: string, month: string) => `${workerId}|${month}`;
export const monthOf = (date: string) => date.slice(0, 7);

/* ───────────── Kalender ───────────── */

/** Ostersonntag (gregorianisch) */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** gesetzliche Feiertage in Österreich */
export function holidaysAT(year: number): Map<string, string> {
  const e = easter(year);
  const fixed: [string, string][] = [
    ['01-01', 'Neujahr'],
    ['01-06', 'Heilige Drei Könige'],
    ['05-01', 'Staatsfeiertag'],
    ['08-15', 'Mariä Himmelfahrt'],
    ['10-26', 'Nationalfeiertag'],
    ['11-01', 'Allerheiligen'],
    ['12-08', 'Mariä Empfängnis'],
    ['12-25', 'Christtag'],
    ['12-26', 'Stefanitag'],
  ];
  const m = new Map<string, string>(fixed.map(([md, n]) => [`${year}-${md}`, n]));
  m.set(addDays(e, 1), 'Ostermontag');
  m.set(addDays(e, 39), 'Christi Himmelfahrt');
  m.set(addDays(e, 50), 'Pfingstmontag');
  m.set(addDays(e, 60), 'Fronleichnam');
  return m;
}
const holidayCache = new Map<number, Map<string, string>>();
export const holidayOn = (date: string): string | null => {
  const y = Number(date.slice(0, 4));
  if (!holidayCache.has(y)) holidayCache.set(y, holidaysAT(y));
  return holidayCache.get(y)!.get(date) ?? null;
};

/** alle Tage eines Monats (JJJJ-MM-TT) */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export const weekdayIdx = (date: string) => (parseDate(date).getDay() + 6) % 7;
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const monthLabel = (month: string) => parseDate(`${month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const thisMonth = () => monthOf(isoDate(new Date()));

/* ───────────── Sollstunden und Vorschlag ───────────── */

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** Stunden eines Arbeitstags laut Firmen-Arbeitszeit; über 6 Stunden 0,5 Stunden Pause (Arbeitszeitgesetz) */
export function plannedHours(times: WorkTimes, date: string): number {
  const t = times[weekdayIdx(date)];
  if (!t || holidayOn(date)) return 0;
  const h = Math.max(0, minutes(t.to) - minutes(t.from)) / 60;
  return h > 6 ? h - 0.5 : h;
}

export interface DaySuggestion {
  lines: TimeLine[];
  absence: Absence['kind'] | null;
  holiday: string | null;
}

/**
 * Vorschlag für einen Arbeiter an einem Tag: Baustellen laut Einteilung (eine Baustelle → volle Stunden;
 * mehrere → aufgeteilt), Stunden laut Firmen-Arbeitszeit. Urlaub/Krank und Feiertage ohne Stunden.
 */
export function suggestDay(workerId: string, date: string, week: WeekPlan | null, times: WorkTimes, absences: Absence[]): DaySuggestion {
  const holiday = holidayOn(date);
  const hits = absences.filter((a) => a.workerId === workerId && date >= a.from && date <= a.to);
  const absence = hits.some((a) => a.kind === 'urlaub') ? 'urlaub' : hits.length ? 'krank' : null;
  if (holiday || absence || !week) return { lines: [], absence, holiday };
  const day = weekdayIdx(date);
  const sites = week.sites.filter((s) => !s.paused && s.days[day]?.includes(workerId));
  const total = plannedHours(times, date);
  if (!sites.length || !total) return { lines: [], absence, holiday };
  const each = Math.round((total / sites.length) * 4) / 4;
  return { lines: sites.map((s) => ({ projectId: s.projectId, siteName: s.name, hours: each })), absence, holiday };
}

export const dayHours = (d: Pick<TimeDay, 'lines'> | null | undefined) => (d ? d.lines.reduce((s, l) => s + (l.hours || 0), 0) : 0);
export const dayTravel = (d: Pick<TimeDay, 'lines'> | null | undefined) => (d ? d.lines.reduce((s, l) => s + (l.travel || 0), 0) : 0);

export interface MonthSummary {
  hours: number;
  travel: number;
  target: number;
  /** Werktage mit Sollzeit ohne Erfassung (bis heute) */
  open: string[];
  vacation: number;
  sick: number;
  bySite: { name: string; hours: number }[];
}

/** Summen eines Monatszettels; offene Tage nur bis zum Stichtag (heute) */
export function summarize(month: string, days: Map<string, TimeDay>, times: WorkTimes, absences: Absence[], workerId: string, until: string): MonthSummary {
  let hours = 0;
  let travel = 0;
  let target = 0;
  let vacation = 0;
  let sick = 0;
  const open: string[] = [];
  const sites = new Map<string, number>();
  for (const date of monthDays(month)) {
    const planned = plannedHours(times, date);
    const hits = absences.filter((a) => a.workerId === workerId && date >= a.from && date <= a.to);
    const abs = hits.some((a) => a.kind === 'urlaub') ? 'urlaub' : hits.length ? 'krank' : null;
    if (planned) {
      target += planned;
      if (abs === 'urlaub') vacation++;
      else if (abs === 'krank') sick++;
    }
    const d = days.get(date);
    if (d) {
      hours += dayHours(d);
      travel += dayTravel(d);
      for (const l of d.lines) sites.set(l.siteName, (sites.get(l.siteName) ?? 0) + (l.hours || 0));
    } else if (planned && !abs && date <= until) open.push(date);
  }
  return { hours, travel, target, open, vacation, sick, bySite: [...sites.entries()].map(([name, h]) => ({ name, hours: h })).sort((a, b) => b.hours - a.hours) };
}

/** Zahl mit Komma, z. B. 8,5 */
export const fmtH = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
/** Eingabe „8,5“ / „8.5“ → Zahl; leer → null */
export function parseHours(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : null;
}

/* ───────────── Excel ───────────── */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Excel für die Lohnverrechnung: „Monat“ (eine Zeile je Person, Spalte je Tag, U = Urlaub, K = Krank, F = Feiertag),
 * „Je Baustelle“ (Stunden je Baustelle und Person) und „Einzeln“ (eine Zeile je Person, Tag und Baustelle).
 * Nur bestätigte Stunden.
 */
export function timesXlsx(month: string, workers: Worker[], days: TimeDay[], absences: Absence[], times: WorkTimes, company = ''): ExportFile {
  const dates = monthDays(month);
  const byWorker = new Map<string, Map<string, TimeDay>>();
  for (const d of days) {
    if (d.month !== month) continue;
    const m = byWorker.get(d.workerId) ?? new Map<string, TimeDay>();
    m.set(d.date, d);
    byWorker.set(d.workerId, m);
  }
  const people = [...workers].sort((a, b) => workerName(a).localeCompare(workerName(b), 'de'));
  const today = isoDate(new Date());

  // Blatt 1: Monat
  const head: Cell[] = [str('Personalnr.', 'header'), str('Name', 'header'), ...dates.map((d) => str(`${WEEKDAYS[weekdayIdx(d)]} ${Number(d.slice(8))}`, 'header')), str('Stunden', 'header'), str('Wegzeit', 'header'), str('Soll', 'header'), str('Urlaub (Tage)', 'header'), str('Krank (Tage)', 'header'), str('Offen (Tage)', 'header')];
  const rows: Cell[][] = [[str(`Zeitaufzeichnung ${monthLabel(month)}${company ? ` – ${company}` : ''}`, 'title')], [], head];
  for (const w of people) {
    const m = byWorker.get(w.id) ?? new Map<string, TimeDay>();
    const s = summarize(month, m, times, absences, w.id, today);
    const cells: Cell[] = dates.map((date) => {
      const d = m.get(date);
      if (d && d.lines.length) return num(dayHours(d), 'area');
      const hits = absences.filter((a) => a.workerId === w.id && date >= a.from && date <= a.to);
      if (hits.some((a) => a.kind === 'urlaub')) return str('U', 'center');
      if (hits.length) return str('K', 'center');
      if (holidayOn(date)) return str('F', 'center');
      return blank();
    });
    rows.push([str(w.staffNo ?? '', 'text'), str(workerName(w), 'text'), ...cells, num(s.hours, 'boldArea'), num(s.travel, 'area'), num(s.target, 'area'), num(s.vacation, 'int'), num(s.sick, 'int'), num(s.open.length, 'int')]);
  }
  const monthSheet: Sheet = { name: 'Monat', rows, widths: [11, 22, ...dates.map(() => 6.5), 10, 9, 9, 9, 9, 9], headerRows: 3, landscape: true, print: true };

  // Blatt 2: Je Baustelle
  const site = new Map<string, Map<string, { h: number; t: number }>>();
  for (const d of days) {
    if (d.month !== month) continue;
    for (const l of d.lines) {
      const m = site.get(l.siteName) ?? new Map<string, { h: number; t: number }>();
      const v = m.get(d.workerId) ?? { h: 0, t: 0 };
      v.h += l.hours || 0;
      v.t += l.travel || 0;
      m.set(d.workerId, v);
      site.set(l.siteName, m);
    }
  }
  const siteRows: Cell[][] = [[str(`Stunden je Baustelle ${monthLabel(month)}`, 'title')], [], [str('Baustelle', 'header'), str('Name', 'header'), str('Stunden', 'header'), str('Wegzeit', 'header')]];
  for (const [name, m] of [...site.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    let sum = 0;
    for (const w of people) {
      const v = m.get(w.id);
      if (!v) continue;
      sum += v.h;
      siteRows.push([str(name, 'text'), str(workerName(w), 'text'), num(v.h, 'area'), num(v.t, 'area')]);
    }
    siteRows.push([str(`${name} gesamt`, 'boldText'), blank(), num(sum, 'boldArea'), blank()]);
  }
  const siteSheet: Sheet = { name: 'Je Baustelle', rows: siteRows, widths: [32, 24, 10, 10], headerRows: 3, print: true };

  // Blatt 3: Einzeln
  const list: Cell[][] = [[str('Datum', 'header'), str('Personalnr.', 'header'), str('Name', 'header'), str('Baustelle', 'header'), str('Stunden', 'header'), str('Wegzeit', 'header'), str('Erfasst von', 'header')]];
  const names = new Map(people.map((w) => [w.id, w]));
  for (const d of [...days].filter((x) => x.month === month).sort((a, b) => a.date.localeCompare(b.date) || workerName(names.get(a.workerId) ?? { firstName: '', lastName: '' }).localeCompare(workerName(names.get(b.workerId) ?? { firstName: '', lastName: '' }), 'de'))) {
    const w = names.get(d.workerId);
    if (!w) continue;
    for (const l of d.lines) list.push([str(parseDate(d.date).toLocaleDateString('de-DE'), 'text'), str(w.staffNo ?? '', 'text'), str(workerName(w), 'text'), str(l.siteName, 'text'), num(l.hours || 0, 'area'), l.travel ? num(l.travel, 'area') : blank(), str(d.updatedBy, 'text')]);
  }
  const listSheet: Sheet = { name: 'Einzeln', rows: list, widths: [11, 11, 22, 30, 9, 9, 18], freezeHeader: true, autoFilter: `A1:G${Math.max(1, list.length)}` };

  return { name: `${safeFileName('Zeitaufzeichnung', month, company)}.xlsx`, data: buildXlsx([monthSheet, siteSheet, listSheet]), mimeType: XLSX_MIME };
}

/** Wochen eines Monats (Montage), um die Einteilung zu laden */
export function weeksOfMonth(month: string): string[] {
  return [...new Set(monthDays(month).map((d) => weekOf(d)))];
}
