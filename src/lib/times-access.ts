import { allowedSites, siteKeyOf } from './access';
import type { Session } from './auth';
import type { TimeDay, TimeLine } from './times';
import type { Worker } from './types';

/**
 * Wer sieht welche Stunden in der Zeitaufzeichnung:
 * - office: Admin, Büro, Betreiber (und ohne Firma) – alle Arbeiter, alle Projekte, Monatszettel, Excel, Freigabe
 * - site:   Polier – nur Stunden auf seinen freigegebenen Projekten erfassen und sehen (leer = alle Projekte);
 *           keine Monatszettel, kein Excel, keine Freigabe
 * - own:    Arbeiter – nur die eigenen Stunden ansehen (Konto über die E-Mail in der Personalliste verknüpft)
 * Dieselben Regeln gelten am Server (Funktion „storage“) – die App blendet nur zusätzlich aus.
 */
export type TimesScope = { level: 'office' } | { level: 'site'; sites: string[] } | { level: 'own'; email: string };

export function timesScope(s: Session | null | undefined): TimesScope {
  if (!s || !s.companyId || s.operator || s.role === 'admin' || s.role === 'buero') return { level: 'office' };
  if (s.role === 'polier') {
    const own = s.toolSites?.times ?? [];
    return { level: 'site', sites: own.length ? own : allowedSites(s, 'workers') };
  }
  return { level: 'own', email: s.email.trim().toLowerCase() };
}

/** Zeile auf einem erlaubten Projekt? */
export function lineAllowed(l: Pick<TimeLine, 'projectId' | 'siteName'>, scope: TimesScope): boolean {
  if (scope.level !== 'site') return scope.level === 'office';
  return !scope.sites.length || scope.sites.includes(siteKeyOf(l.projectId, l.siteName));
}

/** Konto ↔ Arbeiter: Arbeiter, deren hinterlegte Konto-E-Mail zur Anmeldung passt */
export const ownWorkerIds = (workers: Pick<Worker, 'id' | 'userEmail'>[], email: string) =>
  new Set(workers.filter((w) => !!email && (w.userEmail ?? '').trim().toLowerCase() === email).map((w) => w.id));

/** Tage auf das sichtbare zuschneiden: Polier nur Zeilen seiner Projekte (Tage ohne solche Zeilen entfallen), Arbeiter nur eigene Tage */
export function visibleDays(days: TimeDay[], scope: TimesScope, workers: Pick<Worker, 'id' | 'userEmail'>[]): TimeDay[] {
  if (scope.level === 'office') return days;
  if (scope.level === 'own') {
    const own = ownWorkerIds(workers, scope.email);
    return days.filter((d) => own.has(d.workerId));
  }
  if (!scope.sites.length) return days;
  return days.flatMap((d) => {
    const lines = d.lines.filter((l) => lineAllowed(l, scope));
    return lines.length ? [{ ...d, lines }] : [];
  });
}

/** Beim Speichern durch den Polier: Zeilen anderer Projekte (für ihn unsichtbar) bleiben erhalten */
export function mergeHiddenLines(prev: TimeLine[] | undefined, next: TimeLine[], scope: TimesScope): TimeLine[] {
  if (scope.level !== 'site' || !scope.sites.length) return next;
  return [...(prev ?? []).filter((l) => !lineAllowed(l, scope)), ...next.filter((l) => lineAllowed(l, scope))];
}
