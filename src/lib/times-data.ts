import { DEFAULT_WORK_TIMES, weekOf } from './crew';
import { getMeta, getWeek, listProjects, listTimeDays, listTimeMonths, listWorkers, previousWeek, saveTimeDay } from './db';
import { effectiveWeek } from './reports';
import { dayId, monthOf, suggestDay, weeksOfMonth, type DaySuggestion, type TimeDay, type TimeLine, type TimeMonth } from './times';
import type { Absence, WeekPlan, Worker, WorkTimes } from './types';

/** alles, was Übersicht und Monatszettel für einen Monat brauchen */
export interface TimesData {
  month: string;
  workers: Worker[];
  days: TimeDay[];
  approvals: TimeMonth[];
  weeks: Map<string, WeekPlan | null>;
  times: WorkTimes;
  absences: Absence[];
  /** Baustellen zur Auswahl (Projektregister + Baustellen der Einteilung ohne Projekt) */
  sites: { projectId: string | null; name: string }[];
  company: string;
}

export async function loadTimes(month: string): Promise<TimesData> {
  const mondays = weeksOfMonth(month);
  const [workers, days, approvals, times, absences, projects, company, weekList] = await Promise.all([
    listWorkers(),
    listTimeDays(month),
    listTimeMonths(month),
    getMeta<WorkTimes>('workTimes'),
    getMeta<Absence[]>('absences'),
    listProjects(),
    getMeta<string>('companyName'),
    Promise.all(mondays.map(async (id) => effectiveWeek(id, await getWeek(id), await previousWeek(id)))),
  ]);
  const weeks = new Map(mondays.map((id, i) => [id, weekList[i]]));
  const sites: TimesData['sites'] = projects.map((p) => ({ projectId: p.id, name: p.site || p.name }));
  for (const w of weekList) for (const s of w?.sites ?? []) if (!s.projectId && !sites.some((x) => !x.projectId && x.name === s.name)) sites.push({ projectId: null, name: s.name });
  sites.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  // aktive Arbeiter, dazu inaktive mit Stunden in diesem Monat
  const withDays = new Set(days.map((d) => d.workerId));
  return {
    month,
    workers: workers.filter((w) => w.active || withDays.has(w.id)),
    days,
    approvals,
    weeks,
    times: times ?? DEFAULT_WORK_TIMES,
    absences: absences ?? [],
    sites,
    company: company ?? '',
  };
}

export const suggestionFor = (data: TimesData, workerId: string, date: string): DaySuggestion => suggestDay(workerId, date, data.weeks.get(weekOf(date)) ?? null, data.times, data.absences);

/** Tag speichern; nach der Freigabe wird jede Änderung mit Name und Zeitpunkt vermerkt */
export async function saveDay(workerId: string, date: string, lines: TimeLine[], by: string, opts: { prev?: TimeDay; approved?: boolean } = {}): Promise<TimeDay> {
  const now = Date.now();
  const clean = lines.map((l) => ({ projectId: l.projectId, siteName: l.siteName, hours: l.hours, ...(l.travel ? { travel: l.travel } : {}) }));
  const text = clean.map((l) => `${l.siteName} ${l.hours} h${l.travel ? ` + ${l.travel} h Weg` : ''}`).join('; ') || 'keine Stunden';
  const log = [...(opts.prev?.log ?? []), ...(opts.approved ? [{ at: now, by, text }] : [])].slice(-20);
  const d: TimeDay = { id: dayId(workerId, date), workerId, date, month: monthOf(date), lines: clean, updatedAt: now, updatedBy: by, ...(log.length ? { log } : {}) };
  await saveTimeDay(d);
  return d;
}
