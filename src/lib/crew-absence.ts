import { addDays, dayDate } from './crew';
import type { Absence } from './types';

/**
 * Urlaub und Krankmeldungen von–bis (auch über mehrere Wochen), gespeichert als Liste (Meta „absences“).
 * Die Wochen selbst bleiben unverändert: der Arbeiter bleibt auf seiner Baustelle eingeteilt und wird an
 * diesen Tagen nur als „Urlaub“ bzw. „krank“ markiert – danach ist er automatisch wieder dort.
 */

/** Wochentage (0 = Montag) einer Woche, die in den Zeitraum fallen */
export const absenceDays = (a: Pick<Absence, 'from' | 'to'>, weekId: string) =>
  [0, 1, 2, 3, 4, 5, 6].filter((d) => {
    const date = addDays(weekId, d);
    return date >= a.from && date <= a.to;
  });

/** Abwesenheit eines Arbeiters an einem Tag (Urlaub geht vor krank) */
export function absenceOn(list: Absence[], workerId: string, weekId: string, day: number): Absence['kind'] | null {
  const date = addDays(weekId, day);
  const hits = list.filter((a) => a.workerId === workerId && date >= a.from && date <= a.to);
  return hits.some((a) => a.kind === 'urlaub') ? 'urlaub' : hits.length ? 'krank' : null;
}

/** je Arbeiter die Tage einer Woche mit dieser Abwesenheit */
export function absenceSummary(list: Absence[], weekId: string, days: number[], kind: Absence['kind']): { workerId: string; days: number[] }[] {
  const ids = [...new Set(list.filter((a) => a.kind === kind && absenceDays(a, weekId).length).map((a) => a.workerId))];
  return ids.map((workerId) => ({ workerId, days: days.filter((d) => absenceOn(list, workerId, weekId, d) === kind) })).filter((x) => x.days.length);
}

/** „02.11. – 13.11.“ bzw. „02.11.“ */
export const absenceRange = (a: Pick<Absence, 'from' | 'to'>) => {
  const f = dayDate(a.from, 0);
  const t = dayDate(a.to, 0);
  return f === t ? f : `${f} – ${t}`;
};
