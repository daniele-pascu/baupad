/**
 * Baustellen sind in allen Werkzeugen dieselben. Eine Änderung von Name, Nummer oder Adresse – egal in welchem
 * Werkzeug – wird überall nachgezogen: Projekt (Aufmaß & Abrechnung), freie Baustelle (Fotos/Mängelplan),
 * Kopien in Fotos, Mängelplänen, Berichtsköpfen und Wochen der Arbeitereinteilung.
 * Ändern dürfen derzeit Admin und Büro (ohne Arbeitsbereich: jeder).
 */
import type { Session } from './auth';
import { getDB, listDefectPlans, listReports, listWeeks, saveDefectPlan, saveReport, saveWeek, writeRecords } from './db';
import { getPhotoStorage } from './photo-storage';
import { listFreePhotoSites, updateFreePhotoSite } from './photo-sites';
import { photoSiteKey } from './photos';
import { getDeviceId } from './ids';
import type { PhotoSite } from './types';

export interface SiteFields {
  name: string;
  number: string;
  address: string;
}

export const canEditSites = (s: Session | null | undefined) => !s || !s.companyId || s.role === 'admin' || s.role === 'buero' || s.operator;

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
