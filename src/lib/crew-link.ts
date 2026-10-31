import { listProjects, listWeeks, saveWeek, writeRecords, getDB } from './db';
import { getDeviceId } from './ids';
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
export async function projectFromSite(
  site: Pick<WeekSite, 'name' | 'number' | 'address'> & { costCenter?: string; client?: string; date?: string; notes?: string },
  tool = 'workers',
): Promise<Project> {
  // gleicher Name wie ein vorhandenes Projekt (ohne Groß/Klein) → kein Duplikat, das vorhandene Projekt wird übernommen
  const key = site.name.trim().toLowerCase();
  const existing = (await listProjects()).find((p) => !p.deletedAt && ((p.site || p.name).trim().toLowerCase() === key || p.name.trim().toLowerCase() === key));
  if (existing) return adoptProject(existing, tool);
  const cc = (site.costCenter ?? '').trim();
  const { project } = await createProjectWithCostCenters(
    { name: site.name.trim(), number: (site.number ?? '').trim(), site: '', address: (site.address ?? '').trim(), client: (site.client ?? '').trim(), editor: '', date: (site.date ?? '').trim(), notes: (site.notes ?? '').trim(), tools: [tool] },
    [splitCostCenter(cc)],
  );
  return project;
}

/** Kostenstelle aus dem einheitlichen Dialog (ein Feld): „91092“ → Nummer, „91092 – Tiefgarage“ → Nummer + Bezeichnung, „Tiefgarage“ → Bezeichnung */
export function splitCostCenter(text: string): { number: string; name: string } {
  const t = text.trim();
  if (!t) return { number: '', name: '' };
  const m = /^([\d][\d.\-/]*)(?:\s*[–\-:]\s*|\s+)?(.*)$/.exec(t);
  if (m && (m[2] === '' || /^[\d.\-/]+$/.test(m[1]))) return { number: m[1], name: m[2].trim() };
  return { number: '', name: t };
}

/** Erste Kostenstelle je Projekt (Nummer, sonst Bezeichnung) – für die Überschrift in Listen */
export async function costCenterByProject(): Promise<Map<string, string>> {
  const db = await getDB();
  const out = new Map<string, string>();
  for (const c of (await db.getAll('costCenters')).filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex)) {
    const label = (c.number ?? '').trim() || c.name.trim();
    if (label && !out.has(c.projectId)) out.set(c.projectId, label);
  }
  return out;
}

/** Werkzeuge, in denen ein Projekt benutzt wird (ältere Projekte ohne Angabe: Aufmaß & Abrechnung) */
export const projectTools = (p: Pick<Project, 'tools'>): string[] => (p.tools && p.tools.length ? p.tools : ['projects']);
export const usedIn = (p: Pick<Project, 'tools'>, tool: string) => projectTools(p).includes(tool);

/** Projekt in ein weiteres Werkzeug übernehmen (erscheint dann dort in der Übersicht) */
export async function adoptProject(p: Project, tool: string): Promise<Project> {
  if (usedIn(p, tool)) return p;
  const record: Project = { ...p, tools: [...projectTools(p), tool], rev: p.rev + 1, updatedAt: Date.now(), deviceId: getDeviceId() };
  await writeRecords([{ store: 'projects', record, baseRev: p.rev }]);
  return record;
}

/** Projekte des Registers, die in diesem Werkzeug noch nicht benutzt werden (zum Übernehmen) */
export async function registerCandidates(tool: string): Promise<Project[]> {
  return (await listProjects()).filter((p) => !usedIn(p, tool)).sort((a, b) => (a.site || a.name).localeCompare(b.site || b.name, 'de'));
}
