import type { Session } from './auth';

/**
 * Freigaben der angemeldeten Person für den Abgleich. Seit 17.11.2026 liefert die Funktion „storage“ Polier und
 * Arbeiter nur die Daten freigegebener Projekte und Werkzeuge (Preise nur mit „Preise und Summen“). Ändern sich die
 * Freigaben, gleicht das Gerät Daten und Fotos einmal komplett neu ab: neu freigegebene Projekte kommen dazu, entzogene
 * verschwinden (der Server meldet sie als gelöscht). Admin, Büro und Betreiber sehen ohnehin alles.
 */
const VERSION = 1;
export const OFFICE_ACCESS = `v${VERSION}:office`;
/**
 * Meldet die Funktion „storage“, dass sie die Rechte prüft (Antwort `filtered`)? Erst dann lohnt der Neu-Abgleich –
 * die App ist oft schon online, bevor die Funktion neu veröffentlicht ist.
 */
export const SERVER_FILTERS = 'syncServerFilters';

const isOffice = (s: Session) => !s.companyId || s.role === 'admin' || s.role === 'buero' || s.operator;

/** Kennung der Freigaben ('' = unbekannt, z. B. offline gestartet ohne Firmenkontext) */
export function accessKey(s: Session | null | undefined): string {
  if (!s?.companyId) return '';
  if (isOffice(s)) return OFFICE_ACCESS;
  const sorted = (l: readonly string[] | undefined) => [...(l ?? [])].sort().join(',');
  const perTool = Object.keys(s.toolSites ?? {})
    .sort()
    .map((k) => `${k}=${sorted(s.toolSites[k as keyof Session['toolSites']])}`)
    .join(';');
  return `v${VERSION}:${s.role}|${sorted(s.tools)}|${sorted(s.sites)}|${perTool}`;
}

let current = '';
/** aktuelle Freigaben setzen; true = geändert (dann neu abgleichen) */
export function setSyncAccess(s: Session | null | undefined): boolean {
  const key = accessKey(s);
  if (!key || key === current) return false;
  const changed = current !== '';
  current = key;
  return changed;
}
export const syncAccess = () => current;

/**
 * Muss ab dem Anfang abgeglichen werden? `saved` = Freigaben beim letzten Abgleich. Unbekannte Freigaben (offline):
 * nein. Büro ohne gespeicherte Kennung (Geräte von vor dieser Änderung): nein – es bekam schon immer alles.
 */
export function needsFullPull(saved: string | null | undefined, now = current): boolean {
  if (!now || saved === now) return false;
  return !(now === OFFICE_ACCESS && !saved);
}
