import { uuid } from './ids';
import type { Project, WeekPlan, WeekSite, Worker, WorkTimes } from './types';

/**
 * Arbeitereinteilung: Wochenplanung nach Baustellen (Baustelle → Tag → Arbeiter).
 * Reine Funktionen – jede Änderung liefert eine neue Woche, andere Wochen bleiben unberührt.
 */

export const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Standard-Arbeitszeit, bis die Firma ihre eigene einträgt: Mo–Fr 07:00–16:00 */
export const DEFAULT_WORK_TIMES: WorkTimes = [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? { from: '07:00', to: '16:00' } : null));

const pad = (n: number) => String(n).padStart(2, '0');
/** Datum als JJJJ-MM-TT (Ortszeit) */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** JJJJ-MM-TT → Datum (Ortszeit, 12 Uhr – sicher bei Zeitumstellung) */
export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

/** Montag der Woche eines Datums (= Schlüssel der Woche) */
export function weekOf(date: Date | string): string {
  const d = typeof date === 'string' ? parseDate(date) : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}

export function addDays(weekId: string, days: number): string {
  const d = parseDate(weekId);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Kalenderwoche nach ISO 8601 */
export function isoWeekNo(weekId: string): number {
  const d = parseDate(weekId);
  d.setDate(d.getDate() + 3); // der Donnerstag bestimmt Jahr und Woche
  const dayOfYear = Math.round((d.getTime() - new Date(d.getFullYear(), 0, 1, 12).getTime()) / 86400000);
  return Math.floor(dayOfYear / 7) + 1;
}

const fmt = (d: Date, year = false) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${year ? d.getFullYear() : ''}`;
/** Datum eines Wochentags, z. B. „26.10.“ */
export const dayDate = (weekId: string, day: number) => fmt(parseDate(addDays(weekId, day)));
/** Zeitraum, z. B. „26.10. – 30.10.2026“ (bis Freitag bzw. Sonntag) */
export const weekRange = (weekId: string, lastDay = 4) => `${fmt(parseDate(weekId))} – ${fmt(parseDate(addDays(weekId, lastDay)), true)}`;

const emptyDays = () => Array.from({ length: 7 }, () => [] as string[]);

export function emptyWeek(id: string): WeekPlan {
  const now = Date.now();
  return { id, sites: [], vacation: emptyDays(), createdAt: now, updatedAt: now };
}

/**
 * Neue Woche aus der Vorwoche weiterführen: dieselben Baustellen (außer fertiggestellten) mit denselben
 * Arbeitern je Wochentag. Urlaub wird nicht übernommen. Die Vorwoche bleibt unverändert.
 */
export function carryOver(prev: WeekPlan, id: string): WeekPlan {
  const week = emptyWeek(id);
  week.showWeekend = prev.showWeekend;
  week.sites = prev.sites
    .filter((s) => !s.finished)
    .map((s) => ({ ...s, id: uuid(), finished: false, days: s.days.map((d) => [...d]) }));
  return week;
}

const touch = (w: WeekPlan, sites: WeekSite[], vacation = w.vacation): WeekPlan => ({ ...w, sites, vacation, updatedAt: Date.now() });
const mapSite = (w: WeekPlan, siteId: string, f: (s: WeekSite) => WeekSite) => touch(w, w.sites.map((s) => (s.id === siteId ? f(s) : s)));

/** Baustelle hinzufügen (aus einem Projekt oder manuell) */
export function addSite(w: WeekPlan, site: Pick<WeekSite, 'projectId' | 'name' | 'number' | 'address' | 'note'>): { week: WeekPlan; site: WeekSite } {
  const s: WeekSite = { id: uuid(), ...site, days: emptyDays() };
  return { week: touch(w, [...w.sites, s]), site: s };
}

/** Baustelle aus einem Projekt: Bezeichnung zum Zeitpunkt der Einteilung (bleibt bei späterer Umbenennung) */
export const siteFromProject = (p: Pick<Project, 'id' | 'name' | 'number' | 'address'>) => ({ projectId: p.id, name: p.name, number: p.number || '', address: p.address || '' });

export const updateSite = (w: WeekPlan, siteId: string, patch: Partial<Pick<WeekSite, 'name' | 'number' | 'address' | 'finished' | 'paused' | 'note'>>) => mapSite(w, siteId, (s) => ({ ...s, ...patch }));
/** Baustelle pausieren (Standby): alle Arbeiter dieser Woche werden frei; liefert die freigewordenen Arbeiter */
export function pauseSite(w: WeekPlan, siteId: string): { week: WeekPlan; freed: string[] } {
  const site = w.sites.find((s) => s.id === siteId);
  const freed = [...new Set(site?.days.flat() ?? [])];
  return { week: mapSite(w, siteId, (s) => ({ ...s, paused: true, finished: false, days: emptyDays() })), freed };
}

export const removeSite = (w: WeekPlan, siteId: string) => touch(w, w.sites.filter((s) => s.id !== siteId));

/** Arbeiter an Tagen einer Baustelle einteilen (Urlaub an diesen Tagen entfällt) */
export function assign(w: WeekPlan, siteId: string, days: number[], workerIds: string[]): WeekPlan {
  const sites = w.sites.map((s) =>
    s.id !== siteId ? s : { ...s, days: s.days.map((list, d) => (days.includes(d) ? [...list, ...workerIds.filter((id) => !list.includes(id))] : list)) },
  );
  const vacation = w.vacation.map((list, d) => (days.includes(d) ? list.filter((id) => !workerIds.includes(id)) : list));
  return touch(w, sites, vacation);
}

/** Arbeiter an einem Tag von einer Baustelle nehmen */
export const unassign = (w: WeekPlan, siteId: string, day: number, workerId: string) =>
  mapSite(w, siteId, (s) => ({ ...s, days: s.days.map((list, d) => (d === day ? list.filter((id) => id !== workerId) : list)) }));

/**
 * Arbeiter ab einem Tag auf eine andere Baustelle verschieben: an allen Tagen ab `fromDay`, an denen er
 * auf der bisherigen Baustelle war, ist er jetzt auf der neuen.
 */
export function moveWorker(w: WeekPlan, workerId: string, fromSiteId: string, toSiteId: string, fromDay: number): WeekPlan {
  const from = w.sites.find((s) => s.id === fromSiteId);
  if (!from || fromSiteId === toSiteId) return w;
  const days = from.days.map((list, d) => (d >= fromDay && list.includes(workerId) ? d : -1)).filter((d) => d >= 0);
  let next = w;
  for (const d of days) next = unassign(next, fromSiteId, d, workerId);
  return assign(next, toSiteId, days, [workerId]);
}

/** Urlaub an einem Tag ein-/austragen; mit Urlaub ist der Arbeiter an dem Tag auf keiner Baustelle */
export function setVacation(w: WeekPlan, workerId: string, days: number[], on: boolean): WeekPlan {
  const vacation = w.vacation.map((list, d) => (!days.includes(d) ? list : on ? (list.includes(workerId) ? list : [...list, workerId]) : list.filter((id) => id !== workerId)));
  const sites = on ? w.sites.map((s) => ({ ...s, days: s.days.map((list, d) => (days.includes(d) ? list.filter((id) => id !== workerId) : list)) })) : w.sites;
  return touch(w, sites, vacation);
}

/** Baustellen, auf denen ein Arbeiter an einem Tag eingeteilt ist (außer `exceptSiteId`) */
export const sitesOf = (w: WeekPlan, workerId: string, day: number, exceptSiteId?: string) =>
  w.sites.filter((s) => s.id !== exceptSiteId && s.days[day]?.includes(workerId));

/**
 * Noch nicht eingeteilt: aktive Arbeiter, die an einem Arbeitstag auf keiner Baustelle und nicht im Urlaub sind.
 * (Krank zählt nicht – wer krank ist, bleibt trotzdem eingeteilt.)
 */
export function unassigned(w: WeekPlan, workers: Worker[], day: number): Worker[] {
  return workers.filter((x) => x.active && !w.vacation[day]?.includes(x.id) && !w.sites.some((s) => s.days[day]?.includes(x.id)));
}

/** angezeigte Tage: Mo–Fr, mit Wochenende Mo–So */
/** jede Woche zeigt immer alle 7 Tage (Tage ohne Arbeitszeit als „frei“) */
export const visibleDays = () => [0, 1, 2, 3, 4, 5, 6];

export const workerName = (x: Pick<Worker, 'firstName' | 'lastName'>) => [x.firstName, x.lastName].filter(Boolean).join(' ');

/** Arbeiter alphabetisch (Nachname, Vorname) */
export const sortWorkers = (list: Worker[]) =>
  [...list].sort((a, b) => (a.lastName || a.firstName).localeCompare(b.lastName || b.firstName, 'de') || a.firstName.localeCompare(b.firstName, 'de'));

export const timeLabel = (t: WorkTimes[number]) => (t ? `${t.from}–${t.to}` : '');

/** Tage kompakt, z. B. „Mo–Fr“, „Mo, Mi“, „Di–Do, Sa“ */
export function dayList(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j - i >= 2 ? `${DAY_SHORT[sorted[i]]}–${DAY_SHORT[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => DAY_SHORT[d]).join(', '));
    i = j;
  }
  return parts.join(', ');
}

/** Urlaub der Woche je Arbeiter (nur angezeigte Tage) */
export function vacationSummary(w: WeekPlan, days: number[]): { workerId: string; days: number[] }[] {
  const map = new Map<string, number[]>();
  for (const d of days) for (const id of w.vacation[d] ?? []) map.set(id, [...(map.get(id) ?? []), d]);
  return [...map].map(([workerId, ds]) => ({ workerId, days: ds }));
}

/**
 * Arbeiter auf eine Baustelle setzen (Ziehen bzw. Hinzufügen): an den gewählten Tagen ist er nur noch dort –
 * von anderen Baustellen wird er an diesen Tagen automatisch entfernt. Urlaubstage bleiben unberührt
 * (außer `overrideVacation`). Liefert auch, von welchen Baustellen er weggenommen wurde.
 */
export function placeWorker(w: WeekPlan, workerId: string, toSiteId: string, days: number[], overrideVacation = false): { week: WeekPlan; from: string[] } {
  const ds = overrideVacation ? days : days.filter((d) => !w.vacation[d]?.includes(workerId));
  const from = new Set<string>();
  const sites = w.sites.map((s) => {
    if (s.id === toSiteId) return { ...s, days: s.days.map((list, d) => (ds.includes(d) && !list.includes(workerId) ? [...list, workerId] : list)) };
    if (!ds.some((d) => s.days[d].includes(workerId))) return s;
    from.add(s.name);
    return { ...s, days: s.days.map((list, d) => (ds.includes(d) ? list.filter((id) => id !== workerId) : list)) };
  });
  const vacation = overrideVacation ? w.vacation.map((list, d) => (ds.includes(d) ? list.filter((id) => id !== workerId) : list)) : w.vacation;
  return { week: touch(w, sites, vacation), from: [...from] };
}

/** Baustelle derselben Bauvorhaben in einer anderen Woche (gleiches Projekt bzw. gleicher Name) */
export function sameSite(w: WeekPlan, site: Pick<WeekSite, 'projectId' | 'name'>): WeekSite | undefined {
  return w.sites.find((s) => isSameSite(s, site));
}

const isSameSite = (a: Pick<WeekSite, 'projectId' | 'name'>, b: Pick<WeekSite, 'projectId' | 'name'>) =>
  a.projectId && b.projectId ? a.projectId === b.projectId : a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/**
 * In einer bereits geplanten Folgewoche übernehmen: der Arbeiter ist an allen Arbeitstagen (ohne Urlaub)
 * auf derselben Baustelle. Gibt es die Baustelle dort nicht (fertig/entfernt) oder ruht sie, bleibt die Woche unverändert (null).
 */
export function placeInWeek(w: WeekPlan, workerId: string, site: Pick<WeekSite, 'projectId' | 'name'>, workDays: number[]): WeekPlan | null {
  const target = sameSite(w, site);
  if (!target || target.paused) return null;
  return placeWorker(w, workerId, target.id, workDays).week;
}

/** Baustellen, auf denen ein Arbeiter in einer Woche (an irgendeinem Tag) eingeteilt ist */
export const workerSites = (w: WeekPlan, workerId: string, days = [0, 1, 2, 3, 4, 5, 6]) =>
  w.sites.filter((s) => days.some((d) => s.days[d].includes(workerId)));

/**
 * Umsetzung in die bereits gespeicherten Folgewochen weitertragen (aufsteigend sortiert): der Arbeiter bleibt
 * auf der neuen Baustelle, bis er wieder geändert wurde. Halt in der ersten Woche, in der er schon anders
 * eingeteilt ist als vorher (prevSites) oder die Baustelle fehlt (fertig/entfernt). Liefert nur geänderte Wochen.
 */
export function carryPlacement(
  later: WeekPlan[],
  workerId: string,
  prevSites: Pick<WeekSite, 'projectId' | 'name'>[],
  target: Pick<WeekSite, 'projectId' | 'name'>,
  workDays: number[],
): WeekPlan[] {
  const out: WeekPlan[] = [];
  for (const w of later) {
    const changedByHand = workerSites(w, workerId).some((s) => ![...prevSites, target].some((k) => isSameSite(s, k)));
    const next = changedByHand ? null : placeInWeek(w, workerId, target, workDays);
    if (!next) break;
    out.push(next);
  }
  return out;
}
