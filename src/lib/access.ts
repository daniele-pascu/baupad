/**
 * Zugriff je Benutzer: Werkzeuge und Baustellen laut Mitgliedschaft (vom Admin der Firma festgelegt).
 * Admin und Betreiber sehen alles; ohne Anmeldung oder ohne Arbeitsbereich wird nichts eingeschränkt
 * (die Zugangsschleuse verlangt die Anmeldung ohnehin).
 */
import type { Session, ToolId } from './auth';
import { parseRoute, usePath } from './router';
import { useSession } from './use-session';

export const ROUTE_TOOL: Record<string, ToolId> = {
  projects: 'projects',
  project: 'projects',
  costCenter: 'projects',
  plan: 'projects',
  workers: 'workers',
  staff: 'workers',
  reports: 'reports',
  report: 'reports',
  reportSite: 'reports',
  formTemplates: 'reports',
  formTemplate: 'reports',
  formEntry: 'reports',
  times: 'times',
  timesheet: 'times',
  photos: 'photos',
  camera: 'photos',
  photoSite: 'photos',
  defects: 'defects',
  defectSite: 'defects',
  defectPlan: 'defects',
  materials: 'materials',
  materialSite: 'materials',
};

const unrestricted = (s: Session | null | undefined) => !s || !s.companyId || s.role === 'admin' || s.operator;

/** Admin, Büro und Betreiber (bzw. ohne Firma) – sehen z. B. die SV-Nummer der Arbeiter */
export const isOfficeUser = (s: Session | null | undefined) => !s || !s.companyId || s.operator || s.role === 'admin' || s.role === 'buero';

/** Arbeitsbereich noch nicht freigeschaltet (Bestellung offen) – Betreiber sind nie gesperrt */
export const isLocked = (s: Session | null | undefined) => !!s && !!s.companyId && !s.workspaceActive && !s.operator;

export function canTool(s: Session | null | undefined, tool: ToolId): boolean {
  if (unrestricted(s)) return true;
  // Zeitaufzeichnung war früher Teil der Arbeitereinteilung – ältere Freigaben gelten weiter
  return s!.tools.length === 0 || s!.tools.includes(tool) || (tool === 'times' && s!.tools.includes('workers'));
}

/**
 * Liste für die Zeiten (dort gilt am Server dieselbe Regel): zuerst die Einstellung je Werkzeug, sonst die gemeinsame
 * Liste; leer = alle Projekte.
 */
export function allowedSites(s: Session, tool?: ToolId): string[] {
  const perTool = tool ? (s.toolSites?.[tool] ?? []) : [];
  return perTool.length ? perTool : s.sites;
}

/**
 * Baustellen-Schlüssel p:<Projekt> bzw. n:<Name in Kleinbuchstaben>; `tool` = Werkzeug, in dem gefragt wird.
 * Projekte sehen Polier und Arbeiter erst nach der Freigabe (Taste „Freigabe“ im Projekt → gemeinsame Liste) oder
 * wenn sie beim Benutzer für dieses Werkzeug ausgewählt sind. Admin, Büro und Betreiber sehen alle.
 */
export function canSite(s: Session | null | undefined, key: string, tool?: ToolId): boolean {
  if (unrestricted(s) || s!.role === 'buero') return true;
  if (key.startsWith('p:')) return s!.sites.includes(key) || (tool ? (s!.toolSites?.[tool] ?? []).includes(key) : false);
  // Baustellen ohne Projekt (frei eingegebener Name): wie bisher – ohne Auswahl sichtbar
  const list = allowedSites(s!, tool);
  return list.length === 0 || list.includes(key);
}

export const siteKeyOf = (projectId: string | null, name: string) => (projectId ? `p:${projectId}` : `n:${name.trim().toLowerCase()}`);

/** Zugriff in einer Seite; das Werkzeug ergibt sich aus der Adresse (oder wird übergeben) */
export function useAccess(tool?: ToolId) {
  const session = useSession();
  const path = usePath();
  const t = tool ?? ROUTE_TOOL[parseRoute(path).name];
  return {
    session,
    tool: t,
    /** undefined = Sitzung wird noch geladen */
    ready: session !== undefined,
    canTool: (x: ToolId) => canTool(session, x),
    canSite: (key: string) => canSite(session, key, t),
    /** Liste auf erlaubte Projekte dieses Werkzeugs einschränken */
    filterSites: <T,>(list: T[], key: (x: T) => string) => list.filter((x) => canSite(session, key(x), t)),
  };
}
