import { deleteDefectPlanCompletely, deleteFormEntry, deleteMaterial, deleteMaterialItem, deleteReport, getDB, getPhoto, listTrashedPhotos, purgeDeleted, saveDefectPlan, saveFormEntry, saveMaterial, saveMaterialItem, saveReport, writeRecords } from './db';
import { typeInfo as reportType } from './reports';
import { notifyDataChanged } from './data-events';
import { getDeviceId } from './ids';
import { getPhotoStorage, notifyPhotosChanged } from './photo-storage';
import { deleteProjectEverywhere, listTrashedProjects, restoreProject } from './sites';
import { flush, getState, reloadProject, type ProjectState } from './store';
import { trashEntries } from './trash';
import { DAY, TRASH_DAYS } from './trash-purge';
import type { EntityStore, Photo } from './types';

/**
 * Papierkorb über alle Tools: gelöschte Projekte (mit allen Daten), Fotos und Aufmaß (Pläne, Kostenstellen, LV,
 * Originalpläne). Jeder sieht, was auf seinem Gerät liegt – also, wofür er Zugriff hat – und kann es wiederherstellen.
 * Ansicht je Ort (nur in den Tools, nicht in der Tool-Übersicht): im Tool alles dieses Tools, im Projekt bzw. auf der Baustelle nur deren Daten.
 */
export type TrashKind = 'project' | 'photos' | 'aufmass' | DocStore;

export interface TrashItem {
  key: string;
  kind: TrashKind;
  /** Zeitpunkt der Löschung */
  at: number;
  title: string;
  detail: string;
  projectId: string | null;
  /** Fotos ohne Projekt: Baustelle */
  siteName?: string;
  daysLeft: number;
  restore(): Promise<void>;
  /** sofort endgültig löschen (auf allen Geräten) */
  purge(): Promise<void>;
}

/** Wo der Papierkorb geöffnet wird: ohne Angaben = alles (nur noch für Tests/Übersichten) */
export interface TrashScope {
  tool?: 'projects' | 'photos' | 'register' | 'reports' | 'defects' | 'materials';
  projectId?: string | null;
  /** Fotos einer Baustelle ohne Projekt */
  siteName?: string;
}

const daysLeft = (at: number, now: number) => Math.max(1, Math.ceil((at + TRASH_DAYS * DAY - now) / DAY));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Fotos in den Papierkorb (eine Löschung = ein Eintrag); die Dateien bleiben bis zum endgültigen Löschen */
export async function trashPhotos(ids: string[], at = Date.now()): Promise<void> {
  const storage = getPhotoStorage();
  for (const id of ids) {
    const p = await getPhoto(id);
    if (p && !p.deletedAt && !p.trashedAt) await storage.update({ ...p, trashedAt: at });
  }
  notifyPhotosChanged();
}

async function purgePhotos(list: Photo[]): Promise<void> {
  const storage = getPhotoStorage();
  for (const p of list) await storage.remove(p.id);
  notifyPhotosChanged();
}

/** Aufmaß: eine Löschung endgültig entfernen (offenes Projekt vorher speichern, danach neu laden) */
export async function purgeAufmass(projectId: string, at: number): Promise<void> {
  const open = getState().projectId === projectId;
  if (open) await flush();
  await purgeDeleted(0, { projectId, at });
  if (open) await reloadProject();
}

async function restorePhotos(list: Photo[]): Promise<void> {
  const storage = getPhotoStorage();
  for (const p of list) await storage.update({ ...p, trashedAt: null });
  notifyPhotosChanged();
}

/**
 * Berichte, Formulare, Mängelpläne, Material (Materialstamm und Materialliste der Baustelle): gelöscht = „im Papierkorb
 * seit“ (trashedAt), überall ausgeblendet; nach 15 Tagen endgültig gelöscht (trash-purge.ts).
 */
export type DocStore = 'reports' | 'formEntries' | 'defectPlans' | 'materials' | 'materialItems';
type AnyDoc = { id: string; projectId?: string | null; trashedAt?: number | null; updatedAt?: number };
const SAVE: Record<DocStore, (x: never) => Promise<void>> = { reports: saveReport, formEntries: saveFormEntry, defectPlans: saveDefectPlan, materials: saveMaterial, materialItems: saveMaterialItem };
export const PURGE_DOC: Record<DocStore, (id: string) => Promise<void>> = {
  reports: deleteReport,
  formEntries: deleteFormEntry,
  defectPlans: (id) => deleteDefectPlanCompletely(id),
  materials: deleteMaterial,
  materialItems: deleteMaterialItem,
};

/** in den Papierkorb legen (eine Löschung = ein Eintrag) */
export async function trashDocs(store: DocStore, ids: string[], at = Date.now()): Promise<void> {
  const db = await getDB();
  for (const id of ids) {
    const r = (await db.get(store, id)) as AnyDoc | undefined;
    if (r && !r.trashedAt) await SAVE[store]({ ...r, trashedAt: at, updatedAt: Date.now() } as never);
  }
  notifyDataChanged(); // Listen und Papierkorb-Taste (Zahl) sofort neu
}
async function restoreDocs(store: DocStore, list: AnyDoc[]): Promise<void> {
  for (const r of list) await SAVE[store]({ ...r, trashedAt: null, updatedAt: Date.now() } as never);
}
async function purgeDocs(store: DocStore, list: AnyDoc[]): Promise<void> {
  for (const r of list) await PURGE_DOC[store](r.id);
}

/** Titel je Datenart für die Liste des Papierkorbs */
function docTitle(store: DocStore, list: AnyDoc[], projects: Map<string, string>): { title: string; detail: string; site: string } {
  const one = list[0] as Record<string, unknown> & AnyDoc;
  const site = one.projectId ? (projects.get(one.projectId) ?? '') : String(one.siteName ?? (one.head as { site?: string; project?: string } | undefined)?.site ?? (one.head as { project?: string } | undefined)?.project ?? '');
  const n = list.length;
  if (store === 'reports') return { title: n === 1 ? `${reportType(one.type as never)?.label ?? 'Bericht'} Nr. ${one.no}` : `${n} Berichte`, detail: site || 'Bericht', site };
  if (store === 'formEntries') return { title: n === 1 ? `${String(one.templateName)} Nr. ${one.no}` : `${n} Formulare`, detail: site || 'Formular', site };
  if (store === 'defectPlans') return { title: n === 1 ? `Mängelplan „${String(one.title || one.siteName)}“` : `${n} Mängelpläne`, detail: site || 'Mängel', site };
  if (store === 'materials') return { title: n === 1 ? `Material „${String(one.name)}“` : `${n} Materialien`, detail: 'Materialstamm', site: '' };
  return { title: n === 1 ? String(one.name) : `${n} Materialpositionen`, detail: site ? `Materialliste · ${site}` : 'Materialliste', site };
}
const DOC_TOOL: Record<DocStore, NonNullable<TrashScope['tool']>> = { reports: 'reports', formEntries: 'reports', defectPlans: 'defects', materials: 'materials', materialItems: 'materials' };

async function docItems(scope: TrashScope, since: number, now: number): Promise<TrashItem[]> {
  const db = await getDB();
  const projects = new Map((await db.getAll('projects')).map((p) => [p.id, p.site || p.name]));
  const out: TrashItem[] = [];
  for (const store of Object.keys(SAVE) as DocStore[]) {
    if (scope.tool && DOC_TOOL[store] !== scope.tool) continue;
    if (store === 'materials' && (scope.projectId !== undefined || scope.siteName !== undefined)) continue; // Materialstamm gehört zu keinem Projekt
    const groups = new Map<string, AnyDoc[]>();
    for (const r of (await db.getAll(store)) as AnyDoc[]) {
      if (!r.trashedAt || r.trashedAt < since) continue;
      if (scope.projectId !== undefined && (r.projectId ?? null) !== scope.projectId) continue;
      const k = `${r.trashedAt}|${r.projectId ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [k, list] of groups) {
      const t = docTitle(store, list, projects);
      if (scope.siteName !== undefined && (list[0].projectId || t.site.trim().toLowerCase() !== scope.siteName.trim().toLowerCase())) continue;
      const at = list[0].trashedAt!;
      out.push({ key: `${store}:${k}`, kind: store, at, title: t.title, detail: t.detail, projectId: list[0].projectId ?? null, daysLeft: daysLeft(at, now), restore: () => restoreDocs(store, list), purge: () => purgeDocs(store, list) });
    }
  }
  return out;
}

const AUFMASS: EntityStore[] = ['costCenters', 'plans', 'damages', 'components', 'elements', 'files', 'lvDocs'];

/** Aufmaß-Löschungen aller (bzw. eines) Projekts: Einträge wie im Papierkorb des Projekts */
async function aufmassItems(now: number, projectId?: string | null): Promise<TrashItem[]> {
  const db = await getDB();
  const since = now - TRASH_DAYS * DAY;
  const byProject = new Map<string, ProjectState>();
  for (const store of AUFMASS) {
    const all = (projectId ? await db.getAllFromIndex(store as 'plans', 'projectId', projectId) : await db.getAll(store)) as unknown as { id: string; projectId: string; deletedAt: number | null }[];
    for (const r of all) {
      if (!r.deletedAt || r.deletedAt < since) continue;
      const st = byProject.get(r.projectId) ?? ({ costCenters: {}, files: {}, plans: {}, damages: {}, components: {}, elements: {}, lvDocs: {} } as unknown as ProjectState);
      (st[store as keyof ProjectState] as unknown as Record<string, unknown>)[r.id] = r;
      byProject.set(r.projectId, st);
    }
  }
  const projects = new Map((await db.getAll('projects')).map((p) => [p.id, p]));
  const out: TrashItem[] = [];
  for (const [pid, st] of byProject) {
    const project = projects.get(pid);
    if (!project || project.deletedAt) continue; // ganzes Projekt im Papierkorb: steht als Projekt da
    for (const e of trashEntries(st, now))
      out.push({ key: `aufmass:${pid}:${e.at}`, kind: 'aufmass', at: e.at, title: e.title, detail: `${e.detail} · ${project.name}`, projectId: pid, daysLeft: e.daysLeft, restore: () => restoreAufmass(pid, e.at), purge: () => purgeAufmass(pid, e.at) });
  }
  return out;
}

/** Aufmaß: alles, was zu diesem Zeitpunkt im Projekt gelöscht wurde, zurückholen (auch wenn das Projekt nicht offen ist) */
async function restoreAufmass(projectId: string, at: number): Promise<void> {
  // offenes Projekt: ausstehende Änderungen zuerst speichern (Neuladen verwirft die Warteschlange)
  if (getState().projectId === projectId) await flush();
  const db = await getDB();
  const writes = [];
  for (const store of AUFMASS) {
    for (const r of (await db.getAllFromIndex(store as 'plans', 'projectId', projectId)) as unknown as { id: string; rev: number; deletedAt: number | null }[]) {
      if (r.deletedAt === at) writes.push({ store, record: { ...r, deletedAt: null, rev: r.rev + 1, updatedAt: Date.now(), deviceId: getDeviceId() } as never, baseRev: r.rev });
    }
  }
  await writeRecords(writes);
  if (getState().projectId === projectId) await reloadProject();
}

/** Einträge des Papierkorbs für diesen Ort (jüngste zuerst) */
export async function loadTrash(scope: TrashScope = {}, now = Date.now()): Promise<TrashItem[]> {
  const since = now - TRASH_DAYS * DAY;
  const out: TrashItem[] = [];
  const inProject = scope.projectId !== undefined || scope.siteName !== undefined;
  // Projekte: in der Übersicht und in jedem Tool (sie gehören allen Tools), nicht innerhalb eines Projekts
  if (!inProject) {
    for (const p of await listTrashedProjects()) {
      if ((p.deletedAt ?? 0) < since) continue;
      out.push({ key: `project:${p.id}`, kind: 'project', at: p.deletedAt!, title: `Projekt „${p.name}“`, detail: 'mit allen Daten aus allen Tools (außer Einteilung)', projectId: p.id, daysLeft: daysLeft(p.deletedAt!, now), restore: () => restoreProject(p.id), purge: () => deleteProjectEverywhere(p.id) });
    }
  }
  if (!scope.tool || scope.tool === 'photos') {
    const groups = new Map<string, Photo[]>();
    for (const ph of await listTrashedPhotos()) {
      if ((ph.trashedAt ?? 0) < since) continue;
      if (scope.projectId !== undefined && (ph.projectId ?? null) !== scope.projectId) continue;
      if (scope.siteName !== undefined && (ph.projectId || ph.siteName.trim().toLowerCase() !== scope.siteName.trim().toLowerCase())) continue;
      const k = `${ph.trashedAt}|${ph.projectId ?? ''}|${ph.projectId ? '' : ph.siteName}`;
      groups.set(k, [...(groups.get(k) ?? []), ph]);
    }
    for (const [k, list] of groups) {
      const at = list[0].trashedAt!;
      out.push({ key: `photos:${k}`, kind: 'photos', at, title: list.length === 1 ? `Foto vom ${new Date(list[0].takenAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : plural(list.length, 'Foto', 'Fotos'), detail: list[0].siteName || 'Fotos', projectId: list[0].projectId ?? null, siteName: list[0].siteName, daysLeft: daysLeft(at, now), restore: () => restorePhotos(list), purge: () => purgePhotos(list) });
    }
  }
  if (!scope.tool || scope.tool === 'projects') out.push(...(await aufmassItems(now, scope.projectId ?? undefined)));
  out.push(...(await docItems(scope, since, now)));
  return out.sort((a, b) => b.at - a.at);
}
