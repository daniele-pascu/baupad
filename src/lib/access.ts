/**
 * Zugriff je Benutzer: Werkzeuge und Baustellen laut Mitgliedschaft (vom Admin der Firma festgelegt).
 * Admin und Betreiber sehen alles; ohne Anmeldung oder ohne Arbeitsbereich wird nichts eingeschränkt
 * (die Zugangsschleuse verlangt die Anmeldung ohnehin).
 */
import type { Session, ToolId } from './auth';
import { useSession } from './use-session';

export const ROUTE_TOOL: Record<string, ToolId> = {
  projects: 'projects',
  project: 'projects',
  costCenter: 'projects',
  plan: 'projects',
  workers: 'workers',
  reports: 'reports',
  report: 'reports',
  reportSite: 'reports',
  photos: 'photos',
  camera: 'photos',
  photoSite: 'photos',
  defects: 'defects',
  defectSite: 'defects',
  defectPlan: 'defects',
};

const unrestricted = (s: Session | null | undefined) => !s || !s.companyId || s.role === 'admin' || s.operator;

export function canTool(s: Session | null | undefined, tool: ToolId): boolean {
  if (unrestricted(s)) return true;
  return s!.tools.length === 0 || s!.tools.includes(tool);
}

/** Baustellen-Schlüssel p:<Projekt> bzw. n:<Name in Kleinbuchstaben> */
export function canSite(s: Session | null | undefined, key: string): boolean {
  if (unrestricted(s)) return true;
  return s!.sites.length === 0 || s!.sites.includes(key);
}

export const siteKeyOf = (projectId: string | null, name: string) => (projectId ? `p:${projectId}` : `n:${name.trim().toLowerCase()}`);

export function useAccess() {
  const session = useSession();
  return {
    session,
    /** undefined = Sitzung wird noch geladen */
    ready: session !== undefined,
    canTool: (t: ToolId) => canTool(session, t),
    canSite: (key: string) => canSite(session, key),
    /** Liste auf erlaubte Baustellen einschränken */
    filterSites: <T,>(list: T[], key: (x: T) => string) => list.filter((x) => canSite(session, key(x))),
  };
}
