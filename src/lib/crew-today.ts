import { absenceOn } from './crew-absence';
import { carryOver, DEFAULT_WORK_TIMES, isProjectLead, isoDate, weekOf, workerName } from './crew';
import { getMeta, getWeek, listWorkers, previousWeek } from './db';
import { holidayOn, plannedHours, weekdayIdx } from './times';
import type { Absence, WeekPlan, Worker, WorkTimes } from './types';

/**
 * Heute auf der Baustelle (Tools-Seite und Team): wie viele Arbeiter heute eingeteilt sind, wer krank bzw. im
 * Urlaub ist und wer noch frei ist – laut Wocheneinteilung und Urlaub/Krank. Projektleiter werden nicht
 * eingeteilt und zählen nie.
 */
export interface CrewToday {
  date: string;
  /** heute ein Arbeitstag der Firma (kein Feiertag)? */
  workday: boolean;
  holiday: string | null;
  /** auf einer Baustelle eingeteilt und da (ohne Krank und Urlaub) */
  present: Worker[];
  sick: Worker[];
  vacation: Worker[];
  /** aktiv, aber heute auf keiner Baustelle und nicht abwesend */
  open: Worker[];
  /** geplante Stunden heute (Eingeteilte × Firmen-Arbeitszeit ohne Pause) */
  hours: number;
  /** Arbeitszeit heute „07:00–16:00“ (leer an freien Tagen) */
  time: string;
}

const byName = (a: Worker, b: Worker) => workerName(a).localeCompare(workerName(b), 'de');

export function crewToday(week: WeekPlan | null, workers: Worker[], absences: Absence[], times: WorkTimes, date: string): CrewToday {
  const day = weekdayIdx(date);
  const t = times[day];
  const holiday = holidayOn(date);
  const workday = !!t && !holiday;
  const crew = workers.filter((w) => !isProjectLead(w));
  const sites = (week?.sites ?? []).filter((s) => !s.paused);
  const assigned = new Set(sites.flatMap((s) => s.days[day] ?? []));
  const away = (id: string) => (week?.vacation[day]?.includes(id) ? 'urlaub' : week ? absenceOn(absences, id, week.id, day) : null);
  const sick: Worker[] = [];
  const vacation: Worker[] = [];
  const present: Worker[] = [];
  const open: Worker[] = [];
  for (const w of crew) {
    const a = away(w.id);
    if (a === 'krank' && (assigned.has(w.id) || w.active)) sick.push(w);
    else if (a === 'urlaub' && (assigned.has(w.id) || w.active)) vacation.push(w);
    else if (assigned.has(w.id)) present.push(w);
    else if (w.active && workday) open.push(w);
  }
  const hoursEach = workday ? plannedHours(times, date) : 0;
  return {
    date,
    workday,
    holiday,
    present: present.sort(byName),
    sick: sick.sort(byName),
    vacation: vacation.sort(byName),
    open: open.sort(byName),
    hours: present.length * hoursEach,
    time: workday && t ? `${t.from}–${t.to}` : '',
  };
}

/** Stand von heute aus der Ablage: gespeicherte Woche, sonst (wie im Team) die weitergeführte Vorwoche */
export async function loadCrewToday(date = isoDate(new Date())): Promise<CrewToday> {
  const weekId = weekOf(date);
  const [saved, workers, absences, times] = await Promise.all([getWeek(weekId), listWorkers(), getMeta<Absence[]>('absences'), getMeta<WorkTimes>('workTimes')]);
  let week = saved ?? null;
  if (!week) {
    const prev = await previousWeek(weekId);
    week = prev ? carryOver(prev, weekId) : null;
  }
  return crewToday(week, workers, absences ?? [], times ?? DEFAULT_WORK_TIMES, date);
}

/** Initialen für die Köpfe („Müller Anna“ → „AM“ wie Nachname + Vorname) */
export function initials(w: Pick<Worker, 'firstName' | 'lastName'>): string {
  const a = (w.firstName ?? '').trim()[0] ?? '';
  const b = (w.lastName ?? '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}
