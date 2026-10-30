/**
 * Baustellen sind in allen Werkzeugen dieselben. Eine Änderung von Name, Nummer oder Adresse – egal in welchem
 * Werkzeug – wird überall nachgezogen: Projekt (Aufmaß & Abrechnung), freie Baustelle (Fotos/Mängelplan),
 * Kopien in Fotos, Mängelplänen, Berichtsköpfen und Wochen der Arbeitereinteilung.
 * Ändern dürfen derzeit Admin und Büro (ohne Arbeitsbereich: jeder).
 */
import { getAuth, type Session } from './auth';
import { useSession } from './use-session';
import { getDB, getMeta, listDefectPlans, listProjects, listReports, listWeeks, saveDefectPlan, saveReport, saveWeek, setMeta, writeRecords } from './db';
import { adoptProject, projectFromSite, usedIn } from './crew-link';
import { getPhotoStorage } from './photo-storage';
import { clearFreePhotoSites, listFreePhotoSites, updateFreePhotoSite } from './photo-sites';
import { photoSiteKey } from './photos';
import { getDeviceId } from './ids';
import type { PhotoSite } from './types';

export interface SiteFields {
  name: string;
  number: string;
  address: string;
}

export const canEditSites = (s: Session | null | undefined) => !s || !s.companyId || s.role === 'admin' || s.role === 'buero' || s.operator;

/** Projekte anlegen dürfen nur Admin und Büro (Betreiber auch); Polier und Arbeiter wählen aus dem Register */
export const canCreateProjects = canEditSites;

/** für Seiten und Dialoge: darf die angemeldete Person Projekte anlegen? (undefined = Sitzung lädt noch → nein) */
export function useCanCreateProjects(): boolean {
  const session = useSession();
  return session === undefined ? false : canCreateProjects(session);
}

export const siteKeyOfSite = (s: PhotoSite) => photoSiteKey({ projectId: s.projectId, siteName: s.name });

/** Kopien in den anderen Werkzeugen nachziehen (Fotos, Mängelpläne, Berichtsköpfe, Einteilung) */
export async function propagateSite(key: string, next: PhotoSite): Promise<void> {
  const now = Date.now();
  const storage = getPhotoStorage();
  for (const p of await storage.list()) if (photoSiteKey(p) === key) await storage.update({ ...p, siteName: next.name, siteNumber: next.number, siteAddress: next.address, updatedAt: now });
  for (const d of await listDefectPlans()) if (photoSiteKey({ projectId: d.projectId, siteName: d.siteName }) === key) await saveDefectPlan({ ...d, siteName: next.name, siteNumber: next.number, siteAddress: next.address, updatedAt: now });
  for (const r of await listReports()) {
    const rk = r.projectId ? `p:${r.projectId}` : `n:${(r.head.site || r.head.project).trim().toLowerCase()}`;
    if (rk !== key) continue;
    await saveReport({ ...r, head: { ...r.head, site: next.name, number: next.number || r.head.number, address: next.address || r.head.address }, updatedAt: now });
  }
  for (const w of await listWeeks()) {
    let changed = false;
    const sites = w.sites.map((s) => {
      const sk = s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`;
      if (sk !== key) return s;
      changed = true;
      return { ...s, name: next.name, number: next.number, address: next.address };
    });
    if (changed) await saveWeek({ ...w, sites });
  }
}

/**
 * Baustelle ändern und überall übernehmen. Projekt-Baustellen (p:…) ändern das Projekt selbst
 * (Baustellenbezeichnung, Nummer, Adresse); freie Baustellen (n:…) die Baustellenliste.
 */
export async function updateSiteEverywhere(site: PhotoSite, v: SiteFields): Promise<PhotoSite> {
  const key = siteKeyOfSite(site);
  const name = v.name.trim();
  if (!name) throw new Error('Bitte einen Namen für die Baustelle eingeben.');
  let next: PhotoSite;
  if (site.projectId) {
    const db = await getDB();
    const project = await db.get('projects', site.projectId);
    if (!project) throw new Error('Projekt nicht gefunden.');
    const record = { ...project, site: name, number: v.number.trim(), address: v.address.trim(), rev: project.rev + 1, updatedAt: Date.now(), deviceId: getDeviceId() };
    await writeRecords([{ store: 'projects', record, baseRev: project.rev }]);
    next = { projectId: site.projectId, name, number: v.number.trim(), address: v.address.trim() };
  } else {
    next = await updateFreePhotoSite(site.name, v);
  }
  await propagateSite(key, next);
  return next;
}

/** Nach einer Änderung des Projekts in Aufmaß & Abrechnung: Kopien in den anderen Werkzeugen nachziehen */
export async function propagateProject(project: { id: string; site: string; name: string; number?: string; address: string }): Promise<void> {
  await propagateSite(`p:${project.id}`, { projectId: project.id, name: project.site || project.name, number: project.number ?? '', address: project.address });
}

/** Baustelle anhand des Schlüssels aus allen Quellen ermitteln */
export async function findSite(key: string, sites?: PhotoSite[]): Promise<PhotoSite | null> {
  const list = sites ?? (await listFreePhotoSites());
  return list.find((s) => siteKeyOfSite(s) === key) ?? null;
}

/**
 * Projektregister: „Neues Projekt“ aus jedem Werkzeug (Fotos, Berichte, Mängelplan, Einteilung) legt ein echtes
 * Projekt an, das sofort überall erscheint – auch in Aufmaß & Abrechnung (dort ohne Pläne, bis welche kommen).
 */
export async function createSiteProject(v: SiteFields, tool: string): Promise<PhotoSite> {
  const me = await getAuth().session().catch(() => null);
  if (!canCreateProjects(me)) throw new Error('Projekte dürfen nur Admin und Büro anlegen. Bitte ein vorhandenes Projekt wählen.');
  const name = v.name.trim();
  if (!name) throw new Error('Bitte einen Namen für das Projekt eingeben.');
  const p = await projectFromSite({ name, number: v.number.trim(), address: v.address.trim() }, tool);
  return { projectId: p.id, name: p.site || p.name, number: p.number ?? '', address: p.address, tools: p.tools };
}

/** Projekt aus dem Register in ein Werkzeug übernehmen (z. B. beim ersten Foto, Bericht, Plan oder in der Woche) */
export async function useProjectIn(projectId: string | null, tool: string): Promise<void> {
  if (!projectId) return;
  const db = await getDB();
  const p = await db.get('projects', projectId);
  if (p && !usedIn(p, tool)) await adoptProject(p, tool);
}

const ADOPTED = 'freeSitesAdopted';

/**
 * Einmalig: frei eingetippte Baustellen aus der Zeit vor dem Projektregister (Fotos, Berichte, Wochen,
 * Mängelpläne, Baustellenliste) werden zu Projekten; alle Einträge zeigen danach auf das Projekt.
 * Gleicher Name (ohne Groß/Klein) = dasselbe Projekt; gibt es schon ein Projekt mit dieser Baustelle, wird es genommen.
 */
export async function adoptFreeSites(): Promise<number> {
  if (await getMeta<boolean>(ADOPTED)) return 0;
  const storage = getPhotoStorage();
  const [projects, weeks, reports, photos, plans, free] = await Promise.all([listProjects(), listWeeks(), listReports(), storage.list(), listDefectPlans(), listFreePhotoSites()]);
  const byName = new Map<string, { projectId: string; name: string; number: string; address: string }>();
  for (const p of projects) {
    const k = (p.site || p.name).trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, { projectId: p.id, name: p.site || p.name, number: p.number ?? '', address: p.address });
  }
  let created = 0;
  const resolve = async (name: string, tool: string, number = '', address = '') => {
    const k = name.trim().toLowerCase();
    if (!k) return null;
    const have = byName.get(k);
    if (have) {
      await useProjectIn(have.projectId, tool);
      return have;
    }
    const p = await projectFromSite({ name: name.trim(), number, address }, tool);
    const entry = { projectId: p.id, name: name.trim(), number, address };
    byName.set(k, entry);
    created++;
    return entry;
  };
  for (const f of free) await resolve(f.name, 'photos', f.number, f.address);
  for (const w of weeks) {
    let changed = false;
    const sites = [];
    for (const s of w.sites) {
      if (s.projectId) {
        sites.push(s);
        continue;
      }
      const r = await resolve(s.name, 'workers', s.number ?? '', s.address ?? '');
      if (!r) {
        sites.push(s);
        continue;
      }
      changed = true;
      sites.push({ ...s, projectId: r.projectId, number: s.number || r.number, address: s.address || r.address });
    }
    if (changed) await saveWeek({ ...w, sites });
  }
  for (const r of reports) {
    if (r.projectId) continue;
    const e = await resolve(r.head.site || r.head.project, 'reports', r.head.number, r.head.address);
    if (e) await saveReport({ ...r, projectId: e.projectId, updatedAt: Date.now() });
  }
  for (const p of photos) {
    if (p.projectId) continue;
    const e = await resolve(p.siteName, 'photos', p.siteNumber, p.siteAddress);
    if (e) await storage.update({ ...p, projectId: e.projectId, siteName: e.name, siteNumber: p.siteNumber || e.number, siteAddress: p.siteAddress || e.address });
  }
  for (const d of plans) {
    if (d.projectId) continue;
    const e = await resolve(d.siteName, 'defects', d.siteNumber, d.siteAddress);
    if (e) await saveDefectPlan({ ...d, projectId: e.projectId, updatedAt: Date.now() });
  }
  await clearFreePhotoSites();
  await setMeta(ADOPTED, true);
  return created;
}
