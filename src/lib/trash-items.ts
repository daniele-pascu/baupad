import { getDB, getPhoto, listTrashedPhotos, purgeDeleted, writeRecords } from './db';
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
export type TrashKind = 'project' | 'photos' | 'aufmass';

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
  tool?: 'projects' | 'photos' | 'register';
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
  return out.sort((a, b) => b.at - a.at);
}
