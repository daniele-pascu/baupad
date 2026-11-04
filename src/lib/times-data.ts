import { addDays, DEFAULT_WORK_TIMES, weekOf } from './crew';
import { uuid } from './ids';
import { deleteTimeDay, getMeta, getTimeFile, getWeek, listProjects, listTimeDays, listTimeMonths, listWorkers, previousWeek, putTimeFile, saveTimeDay, saveTimeMonth, setMeta } from './db';
import type { ExportFile } from './aufmass';
import type { YearCarry } from './time-workbook';
import { effectiveWeek } from './reports';
import { dayId, hoursOf, monthOf, pauseOf, suggestDay, validTime, weeksOfMonth, type DaySuggestion, type TimeDay, type TimeDefaults, type TimeLine, type TimeMonth } from './times';
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
  /** zuletzt eingetragene Zeiten je Arbeiter */
  defaults: TimeDefaults;
  /** Arbeitszeiten der Firma schon festgelegt (sonst einmalig fragen) */
  timesSet: boolean;
}

export async function loadTimes(month: string): Promise<TimesData> {
  const mondays = weeksOfMonth(month);
  const [workers, days, approvals, times, absences, projects, company, defaults, weekList] = await Promise.all([
    listWorkers(),
    listTimeDays(month),
    listTimeMonths(month),
    getMeta<WorkTimes>('workTimes'),
    getMeta<Absence[]>('absences'),
    listProjects(),
    getMeta<string>('companyName'),
    getMeta<TimeDefaults>('timeDefaults'),
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
    timesSet: !!times,
    absences: absences ?? [],
    sites,
    company: company ?? '',
    // mit festgelegten Firmen-Arbeitszeiten gelten diese als Vorschlag; Abweichungen werden je Tag ausgebessert
    defaults: times ? {} : (defaults ?? {}),
  };
}

export const suggestionFor = (data: TimesData, workerId: string, date: string): DaySuggestion => suggestDay(workerId, date, data.weeks.get(weekOf(date)) ?? null, data.times, data.absences, data.defaults);

/** Tag speichern; nach der Freigabe wird jede Änderung mit Name und Zeitpunkt vermerkt */
export async function saveDay(workerId: string, date: string, lines: TimeLine[], by: string, opts: { prev?: TimeDay; approved?: boolean; remember?: boolean } = {}): Promise<TimeDay> {
  const now = Date.now();
  const clean: TimeLine[] = lines.map((l) => {
    const timed = validTime(l.from) && validTime(l.to);
    // Pause von–bis eingetragen: Dauer daraus (automatisch)
    const pt = validTime(l.pauseFrom) && validTime(l.pauseTo);
    const pause = pt ? pauseOf(l.pauseFrom, l.pauseTo) : (l.pause ?? 0);
    return {
      projectId: l.projectId,
      siteName: l.siteName,
      hours: timed ? hoursOf(l.from!, l.to!, pause) : l.hours,
      ...(timed ? { from: l.from, to: l.to, pause, ...(pt ? { pauseFrom: l.pauseFrom, pauseTo: l.pauseTo } : {}) } : {}),
      ...(l.travel ? { travel: l.travel } : {}),
    };
  });
  const text = clean.map((l) => `${l.siteName} ${l.from ? `${l.from}–${l.to}, ` : ''}${l.hours} h${l.travel ? ` + ${l.travel} h Weg` : ''}`).join('; ') || 'keine Stunden';
  const log = [...(opts.prev?.log ?? []), ...(opts.approved ? [{ at: now, by, text }] : [])].slice(-20);
  const d: TimeDay = { id: dayId(workerId, date), workerId, date, month: monthOf(date), lines: clean, updatedAt: now, updatedBy: by, ...(log.length ? { log } : {}) };
  await saveTimeDay(d);
  // eine Baustelle mit Zeiten: diese Zeiten gelten ab jetzt als Vorschlag für den Arbeiter
  if (opts.remember && clean.length === 1 && clean[0].from) {
    const all = (await getMeta<TimeDefaults>('timeDefaults')) ?? {};
    const cur = all[workerId];
    const c = clean[0];
    if (!cur || cur.from !== c.from || cur.to !== c.to || cur.pause !== (c.pause ?? 0) || cur.pauseFrom !== c.pauseFrom || cur.pauseTo !== c.pauseTo)
      await setMeta('timeDefaults', { ...all, [workerId]: { from: c.from!, to: c.to!, pause: c.pause ?? 0, ...(c.pauseFrom ? { pauseFrom: c.pauseFrom, pauseTo: c.pauseTo } : {}) } });
  }
  return d;
}

/** alle erfassten Tage eines Jahres (für die Jahresdatei) */
export async function loadYearDays(year: number): Promise<TimeDay[]> {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return (await Promise.all(months.map((m) => listTimeDays(m)))).flat();
}

/** Jahresdatei eines Arbeiters in der Firmenvorlage (Stand jetzt) */
export async function workerYearFile(data: TimesData, workerId: string, year: number, month?: string): Promise<ExportFile> {
  const worker = data.workers.find((w) => w.id === workerId);
  if (!worker) throw new Error('Arbeiter nicht gefunden.');
  const { timeYearFile } = await import('./time-workbook');
  return timeYearFile({ year, worker, times: data.times, absences: data.absences, days: await loadYearDays(year), carry: await yearCarry(data, worker, year) }, month);
}

/**
 * Übertrag aus den Vorjahren: zurück bis zum ersten Jahr ohne Einträge, dann Jahr für Jahr nachrechnen
 * (Resturlaub und Stunden +/- wie im Dezember der Vorlage). Ohne Vorjahr: undefined (Urlaubsanspruch, 0 Stunden).
 */
async function yearCarry(data: TimesData, worker: Worker, year: number) {
  const { yearEnd } = await import('./time-workbook');
  const chain: { year: number; days: TimeDay[] }[] = [];
  for (let y = year - 1; y >= year - 15; y--) {
    const days = (await loadYearDays(y)).filter((d) => d.workerId === worker.id);
    const absent = data.absences.some((a) => a.workerId === worker.id && a.from <= `${y}-12-31` && a.to >= `${y}-01-01`);
    if (!days.length && !absent) break;
    chain.unshift({ year: y, days });
  }
  let carry: YearCarry | undefined;
  for (const c of chain) carry = yearEnd({ year: c.year, worker, times: data.times, absences: data.absences, days: c.days, carry });
  return carry;
}

/** Monat freigeben und die Datei des Arbeiters (Jahresdatei, Stand dieses Monats) in der Ablage speichern */
export async function approveMonth(data: TimesData, workerId: string, month: string, by: string): Promise<void> {
  const f = await workerYearFile(data, workerId, Number(month.slice(0, 4)), month);
  const fileId = `zeit_${workerId}_${month}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  await putTimeFile(fileId, f.data.slice().buffer);
  await saveTimeMonth({ id: `${workerId}|${month}`, workerId, month, approvedAt: Date.now(), approvedBy: by, fileId });
}

/** gespeicherte Datei eines freigegebenen Monats */
export async function storedMonthFile(data: TimesData, m: TimeMonth): Promise<ExportFile | null> {
  if (!m.fileId) return null;
  const bytes = await getTimeFile(m.fileId);
  if (!bytes) return null;
  const worker = data.workers.find((w) => w.id === m.workerId);
  const { yearFileName } = await import('./time-workbook');
  return { name: yearFileName(Number(m.month.slice(0, 4)), worker ?? { firstName: 'Arbeiter', lastName: '' }, m.month), data: new Uint8Array(bytes), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

/**
 * Urlaub oder Krank für einen Arbeiter an einem Tag (gemeinsame Liste der Arbeitereinteilung): der Tag wird aus
 * bestehenden Zeiträumen herausgenommen und neu eingetragen; der Tag gilt dann als erfasst (ohne Stunden).
 * null: wieder anwesend – die Erfassung des Tages wird zurückgesetzt (Vorschlag aus der Einteilung).
 */
export async function setDayAbsence(workerId: string, date: string, kind: Absence['kind'] | null, by: string): Promise<void> {
  const list = (await getMeta<Absence[]>('absences')) ?? [];
  const out: Absence[] = [];
  for (const a of list) {
    if (a.workerId !== workerId || date < a.from || date > a.to) {
      out.push(a);
      continue;
    }
    if (a.from < date) out.push({ ...a, to: addDays(date, -1) });
    if (a.to > date) out.push({ ...a, id: uuid(), from: addDays(date, 1) });
  }
  if (kind) out.push({ id: uuid(), workerId, kind, from: date, to: date, createdAt: Date.now() });
  await setMeta('absences', out);
  if (kind) await saveDay(workerId, date, [], by);
  else await deleteTimeDay(dayId(workerId, date));
}
