import { listWeeks, saveWeek } from './db';
import { createProjectWithCostCenters } from './store';
import type { Project, WeekSite } from './types';

/**
 * Verbindung Arbeitereinteilung ↔ Aufmaß & Abrechnung: Baustellen ohne Projekt als Projekt anlegen bzw.
 * beim Anlegen eines Projekts eine Baustelle aus der Arbeitereinteilung übernehmen.
 */

const key = (s: string) => s.trim().toLowerCase();

/** Baustellen der Arbeitereinteilung ohne Projekt (aus allen gespeicherten Wochen, je Name einmal, neueste Angaben) */
export async function sitesWithoutProject(): Promise<Pick<WeekSite, 'name' | 'number' | 'address'>[]> {
  const weeks = (await listWeeks()).sort((a, b) => b.id.localeCompare(a.id));
  const seen = new Map<string, Pick<WeekSite, 'name' | 'number' | 'address'>>();
  for (const w of weeks)
    for (const s of w.sites) if (!s.projectId && s.name.trim() && !seen.has(key(s.name))) seen.set(key(s.name), { name: s.name, number: s.number ?? '', address: s.address ?? '' });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Gleichnamige Baustellen ohne Projekt in allen Wochen mit dem Projekt verknüpfen (Bezeichnungen bleiben) */
export async function linkSitesToProject(name: string, projectId: string): Promise<number> {
  let n = 0;
  for (const w of await listWeeks()) {
    if (!w.sites.some((s) => !s.projectId && key(s.name) === key(name))) continue;
    await saveWeek({ ...w, sites: w.sites.map((s) => (!s.projectId && key(s.name) === key(name) ? { ...s, projectId } : s)), updatedAt: Date.now() });
    n++;
  }
  return n;
}

/** Projekt aus einer Baustelle anlegen (Name, Nummer, Adresse; ohne Kostenstelle – später ergänzbar) */
export async function projectFromSite(site: Pick<WeekSite, 'name' | 'number' | 'address'>): Promise<Project> {
  const { project } = await createProjectWithCostCenters(
    { name: site.name.trim(), number: (site.number ?? '').trim(), site: '', address: (site.address ?? '').trim(), client: '', editor: '', date: '', notes: '' },
    [{ number: '', name: '' }],
  );
  return project;
}
