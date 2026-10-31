import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Component, CostCenter, Damage, DrawElement, EntityMap, EntityStore, LvDocument, Photo, Plan, Project, Report, SourceFile, WeekPlan, Worker, DefectMark, DefectPlan } from './types';
import type { FormTemplate } from './form-template';

/**
 * Lokale Datenbank (IndexedDB). Sie funktioniert ohne Internetverbindung und hält
 * Projektdaten und Originaldateien auf dem Gerät.
 */
interface AufmassDB extends DBSchema {
  projects: { key: string; value: Project };
  costCenters: { key: string; value: CostCenter; indexes: { projectId: string } };
  files: { key: string; value: SourceFile; indexes: { projectId: string } };
  /** Inhalt der Originaldateien (ArrayBuffer – zuverlässiger als Blob in älteren Safari-Versionen) */
  blobs: { key: string; value: { id: string; projectId: string; data: ArrayBuffer } ; indexes: { projectId: string } };
  plans: { key: string; value: Plan; indexes: { projectId: string } };
  damages: { key: string; value: Damage; indexes: { projectId: string } };
  /** Nur lokal: Vorschaubilder der Pläne */
  thumbs: { key: string; value: { id: string; projectId: string; data: Blob }; indexes: { projectId: string } };
  /** Nur lokal: zuletzt verwendete Planansicht */
  views: { key: string; value: { id: string; projectId: string; scale: number; cx: number; cy: number }; indexes: { projectId: string } };
  meta: { key: string; value: { key: string; value: unknown } };
  /** ab Version 2: Bauteilkennzeichnungen (A, B, C …) */
  components: { key: string; value: Component; indexes: { projectId: string } };
  /**
   * ab Version 2: dauerhafte Änderungs-Warteschlange für die spätere Synchronisierung.
   * Ein Eintrag je geändertem Datensatz (der neueste Stand zählt) – wiederholtes Übertragen
   * legt daher keine Doppel an.
   */
  outbox: { key: string; value: OutboxEntry; indexes: { projectId: string } };
  /** ab Version 3: Zeichnungsobjekte selbst gezeichneter Pläne (Maße in m) */
  elements: { key: string; value: DrawElement; indexes: { projectId: string } };
  /** ab Version 4: Leistungsverzeichnisse und Mehrkostenforderungen */
  lvDocs: { key: string; value: LvDocument; indexes: { projectId: string } };
  /** ab Version 5: Arbeitereinteilung – Arbeiter der Firma */
  workers: { key: string; value: Worker };
  /** ab Version 5: Arbeitereinteilung – eine Wochenplanung je Woche (Schlüssel = Montag JJJJ-MM-TT) */
  weeks: { key: string; value: WeekPlan };
  /** ab Version 6: Berichte & Formulare (Regielisten, Bautages- und Bauwochenberichte) */
  reports: { key: string; value: Report; indexes: { projectId: string } };
  /** ab Version 7: Fotodokumentation – Angaben je Foto (Baustelle, Tag, Woche, Benutzer, Status) */
  photos: { key: string; value: Photo; indexes: { projectId: string; week: string; day: string } };
  /** ab Version 7: Bilddaten (verkleinert, Vorschaubild, optional Original) – nur lokal bis zur zentralen Ablage */
  photoBlobs: { key: string; value: { id: string; data: ArrayBuffer; thumb: ArrayBuffer; original?: ArrayBuffer } };
  /** ab Version 8: Mängelplan – Pläne je Baustelle, Markierungen, Planbilder */
  defectPlans: { key: string; value: DefectPlan; indexes: { projectId: string } };
  defectMarks: { key: string; value: DefectMark; indexes: { planId: string } };
  /** ab Version 9: eigene Firmenformulare (Vorlage + Original-PDF) */
  formTemplates: { key: string; value: FormTemplate };
  formTemplateFiles: { key: string; value: { id: string; data: ArrayBuffer } };
  /** Planbild (JPEG), Vorschau und – bei PDF-Plänen – die Originaldatei für scharfes Nachrendern beim Zoomen */
  defectPlanImages: { key: string; value: { id: string; data: ArrayBuffer; thumb: ArrayBuffer; pdf?: ArrayBuffer } };
}

export interface OutboxEntry {
  /** „store:id“ */
  id: string;
  projectId: string;
  store: EntityStore;
  recordId: string;
  rev: number;
  updatedAt: number;
}

const DB_NAME = 'schadstellen-aufmass';
/**
 * Version 1: Grundversion. Version 2: Bauteile und Änderungs-Warteschlange.
 * Version 3: Zeichnungsobjekte selbst gezeichneter Pläne. Version 4: LV und MFK.
 * Version 5: Arbeitereinteilung (Arbeiter, Wochenplanungen). Version 6: Berichte & Formulare. Version 7: Fotodokumentation.
 * Upgrades legen ausschließlich neue Speicherbereiche an; vorhandene Daten bleiben unverändert.
 */
const DB_VERSION = 9;

let dbPromise: Promise<IDBPDatabase<AufmassDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AufmassDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AufmassDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' });
          for (const name of ['costCenters', 'files', 'blobs', 'plans', 'damages', 'thumbs', 'views'] as const) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            store.createIndex('projectId', 'projectId');
          }
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('components', { keyPath: 'id' }).createIndex('projectId', 'projectId');
          db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
        if (oldVersion < 3) {
          db.createObjectStore('elements', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
        if (oldVersion < 4) {
          db.createObjectStore('lvDocs', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
        if (oldVersion < 5) {
          db.createObjectStore('workers', { keyPath: 'id' });
          db.createObjectStore('weeks', { keyPath: 'id' });
        }
        if (oldVersion < 6) {
          db.createObjectStore('reports', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
        if (oldVersion < 7) {
          const photos = db.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('projectId', 'projectId');
          photos.createIndex('week', 'week');
          photos.createIndex('day', 'day');
          db.createObjectStore('photoBlobs', { keyPath: 'id' });
        }
        if (oldVersion < 8) {
          db.createObjectStore('defectPlans', { keyPath: 'id' }).createIndex('projectId', 'projectId');
          db.createObjectStore('defectMarks', { keyPath: 'id' }).createIndex('planId', 'planId');
          db.createObjectStore('defectPlanImages', { keyPath: 'id' });
        }
        if (oldVersion < 9) {
          db.createObjectStore('formTemplates', { keyPath: 'id' });
          db.createObjectStore('formTemplateFiles', { keyPath: 'id' });
        }
        // Hinweis für Aufmaß & Abrechnung, dass die Datenbank erweitert wurde
        if (oldVersion >= 1) void tx.objectStore('meta').put({ key: 'upgradedFrom', value: oldVersion });
      },
      blocking() {
        // Eine neuere Version der App wurde in einem anderen Tab geöffnet.
        dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('meta', key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key, value });
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll('projects');
  return all.filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface ProjectData {
  project: Project;
  costCenters: CostCenter[];
  files: SourceFile[];
  plans: Plan[];
  damages: Damage[];
  components: Component[];
  elements: DrawElement[];
  lvDocs: LvDocument[];
}

/** Lädt alle Datensätze eines Projekts (inklusive Grabsteine). */
export async function loadProjectData(projectId: string): Promise<ProjectData | null> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'costCenters', 'files', 'plans', 'damages', 'components', 'elements', 'lvDocs'], 'readonly');
  const project = await tx.objectStore('projects').get(projectId);
  if (!project || project.deletedAt) return null;
  const [costCenters, files, plans, damages, components, elements, lvDocs] = await Promise.all([
    tx.objectStore('costCenters').index('projectId').getAll(projectId),
    tx.objectStore('files').index('projectId').getAll(projectId),
    tx.objectStore('plans').index('projectId').getAll(projectId),
    tx.objectStore('damages').index('projectId').getAll(projectId),
    tx.objectStore('components').index('projectId').getAll(projectId),
    tx.objectStore('elements').index('projectId').getAll(projectId),
    tx.objectStore('lvDocs').index('projectId').getAll(projectId),
  ]);
  await tx.done;
  return { project, costCenters, files, plans, damages, components, elements, lvDocs };
}

export class ConflictError extends Error {
  constructor(
    public store: EntityStore,
    public id: string,
  ) {
    super('Der Datensatz wurde zwischenzeitlich an anderer Stelle geändert.');
  }
}

export interface PendingWrite<S extends EntityStore = EntityStore> {
  store: S;
  record: EntityMap[S];
  /** Revision, die beim letzten Speichern in der Datenbank stand (0 = neu) */
  baseRev: number;
}

/**
 * Schreibt mehrere Datensätze in einer Transaktion. Vor dem Überschreiben wird geprüft,
 * ob die gespeicherte Revision noch der erwarteten entspricht. Andernfalls wurde der
 * Datensatz zwischenzeitlich z. B. in einem anderen Tab geändert, und es wird nichts
 * überschrieben (ConflictError).
 */
export async function writeRecords(writes: PendingWrite[]): Promise<void> {
  if (!writes.length) return;
  const db = await getDB();
  const stores: (EntityStore | 'outbox')[] = [...new Set(writes.map((w) => w.store)), 'outbox'];
  const tx = db.transaction(stores, 'readwrite');
  // Bei Abbruch (Konflikt) lehnt tx.done ab – das ist hier erwartet und wird über den catch-Block gemeldet.
  tx.done.catch(() => {});
  try {
    for (const w of writes) {
      const store = tx.objectStore(w.store);
      const existing = (await store.get(w.record.id)) as EntityMap[EntityStore] | undefined;
      const existingRev = existing?.rev ?? 0;
      if (existingRev !== w.baseRev) {
        throw new ConflictError(w.store, w.record.id);
      }
      await store.put(w.record as never);
      // Änderung für die spätere Synchronisierung vormerken (gleiche Transaktion → nie verloren)
      const projectId = w.store === 'projects' ? w.record.id : (w.record as { projectId: string }).projectId;
      await tx.objectStore('outbox').put({
        id: `${w.store}:${w.record.id}`,
        projectId,
        store: w.store,
        recordId: w.record.id,
        rev: w.record.rev,
        updatedAt: w.record.updatedAt,
      });
    }
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* bereits beendet */
    }
    throw e;
  }
}

export async function putBlob(id: string, projectId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put('blobs', { id, projectId, data });
}

export async function getBlob(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return (await db.get('blobs', id))?.data;
}

export async function putThumb(id: string, projectId: string, data: Blob): Promise<void> {
  const db = await getDB();
  await db.put('thumbs', { id, projectId, data });
}

export async function getThumb(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get('thumbs', id))?.data;
}

export async function deleteThumb(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('thumbs', id);
}

export async function getView(planId: string) {
  const db = await getDB();
  return db.get('views', planId);
}

export async function putView(view: { id: string; projectId: string; scale: number; cx: number; cy: number }) {
  const db = await getDB();
  await db.put('views', view);
}

/** Löscht ein Projekt mit allen zugehörigen Daten endgültig von diesem Gerät. */
export async function deleteProjectCompletely(projectId: string): Promise<void> {
  const db = await getDB();
  const storeNames = ['costCenters', 'files', 'blobs', 'plans', 'damages', 'components', 'elements', 'lvDocs', 'outbox', 'thumbs', 'views'] as const;
  const tx = db.transaction(['projects', ...storeNames], 'readwrite');
  for (const name of storeNames) {
    const store = tx.objectStore(name);
    const keys = await store.index('projectId').getAllKeys(projectId);
    for (const key of keys) await store.delete(key);
  }
  await tx.objectStore('projects').delete(projectId);
  await tx.done;
}

/** Projektübersicht: Anzahl Kostenstellen, Pläne und Schadstellen. */
export async function projectStats(projectId: string) {
  const db = await getDB();
  const [cc, plans, damages] = await Promise.all([
    db.getAllFromIndex('costCenters', 'projectId', projectId),
    db.getAllFromIndex('plans', 'projectId', projectId),
    db.getAllFromIndex('damages', 'projectId', projectId),
  ]);
  const liveCc = cc.filter((x) => !x.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex);
  return {
    /** Kostenstellennummern bzw. -bezeichnungen (für Suche, Sortierung und Anzeige) */
    costCenterNumbers: liveCc.map((c) => c.number?.trim() ?? '').filter(Boolean),
    costCenterNames: liveCc.map((c) => c.name.trim()).filter(Boolean),
    // leere Kostenstelle (Projekt ohne Kostenstelle) zählt nicht mit
    costCenters: liveCc.filter((c) => c.number?.trim() || c.name.trim()).length,
    plans: plans.filter((x) => !x.deletedAt).length,
    damages: damages.filter((x) => !x.deletedAt).length,
  };
}

// ---------------------------------------------------------------------------
// Arbeitereinteilung

export async function listWorkers(): Promise<Worker[]> {
  return (await getDB()).getAll('workers');
}

export async function saveWorker(w: Worker): Promise<void> {
  await (await getDB()).put('workers', w);
}

/**
 * Mitarbeiter endgültig löschen: aus der Personalliste, aus allen Wochen der Einteilung und aus Urlaub/Krank.
 * Berichte behalten die Kopie des Namens.
 */
export async function deleteWorker(id: string): Promise<void> {
  const db = await getDB();
  for (const week of await db.getAll('weeks')) {
    let changed = false;
    for (const site of week.sites) {
      site.days = site.days.map((ids) => {
        if (!ids.includes(id)) return ids;
        changed = true;
        return ids.filter((x) => x !== id);
      });
    }
    if (changed) await db.put('weeks', week);
  }
  const absences = (await getMeta<{ workerId: string }[]>('absences')) ?? [];
  if (absences.some((a) => a.workerId === id)) await setMeta('absences', absences.filter((a) => a.workerId !== id));
  await db.delete('workers', id);
}

export async function listWeeks(): Promise<WeekPlan[]> {
  return (await getDB()).getAll('weeks');
}

export async function getWeek(id: string): Promise<WeekPlan | undefined> {
  return (await getDB()).get('weeks', id);
}

export async function saveWeek(w: WeekPlan): Promise<void> {
  await (await getDB()).put('weeks', w);
}

/** Letzte gespeicherte Woche vor `id` (zum Weiterführen) */
export async function previousWeek(id: string): Promise<WeekPlan | undefined> {
  const db = await getDB();
  const cursor = await db.transaction('weeks').store.openCursor(IDBKeyRange.upperBound(id, true), 'prev');
  return cursor?.value;
}

/* Berichte & Formulare */
export async function listReports(): Promise<Report[]> {
  return (await getDB()).getAll('reports');
}

export async function getReport(id: string): Promise<Report | undefined> {
  return (await getDB()).get('reports', id);
}

export async function saveReport(r: Report): Promise<void> {
  await (await getDB()).put('reports', r);
}

export async function deleteReport(id: string): Promise<void> {
  await (await getDB()).delete('reports', id);
}

/* Fotodokumentation */
export async function listPhotos(): Promise<Photo[]> {
  return (await (await getDB()).getAll('photos')).filter((p) => !p.deletedAt);
}

/** alle Fotos einschließlich der zum Löschen vorgemerkten (Abgleich mit der Ablage) */
export async function listAllPhotos(): Promise<Photo[]> {
  return (await getDB()).getAll('photos');
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return (await getDB()).get('photos', id);
}

export async function savePhoto(p: Photo): Promise<void> {
  await (await getDB()).put('photos', p);
}

export async function putPhotoBlob(v: { id: string; data: ArrayBuffer; thumb: ArrayBuffer; original?: ArrayBuffer }): Promise<void> {
  await (await getDB()).put('photoBlobs', v);
}

export async function getPhotoBlob(id: string) {
  return (await getDB()).get('photoBlobs', id);
}

export async function deletePhotoBlob(id: string): Promise<void> {
  await (await getDB()).delete('photoBlobs', id);
}

/** Foto und Bilddaten endgültig vom Gerät entfernen */
export async function deletePhotoCompletely(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['photos', 'photoBlobs'], 'readwrite');
  await tx.objectStore('photos').delete(id);
  await tx.objectStore('photoBlobs').delete(id);
  await tx.done;
}

// ---------------------------------------------------------------------------
// Mängelplan

export async function listDefectPlans(): Promise<DefectPlan[]> {
  const db = await getDB();
  return db.getAll('defectPlans');
}
export async function getDefectPlan(id: string): Promise<DefectPlan | undefined> {
  const db = await getDB();
  return db.get('defectPlans', id);
}
export async function saveDefectPlan(p: DefectPlan): Promise<void> {
  const db = await getDB();
  await db.put('defectPlans', p);
}
export async function putDefectPlanImage(v: { id: string; data: ArrayBuffer; thumb: ArrayBuffer; pdf?: ArrayBuffer }): Promise<void> {
  const db = await getDB();
  await db.put('defectPlanImages', v);
}
export async function getDefectPlanImage(id: string) {
  const db = await getDB();
  return db.get('defectPlanImages', id);
}
export async function listDefectMarks(planId?: string): Promise<DefectMark[]> {
  const db = await getDB();
  return planId ? db.getAllFromIndex('defectMarks', 'planId', planId) : db.getAll('defectMarks');
}
export async function saveDefectMark(m: DefectMark): Promise<void> {
  const db = await getDB();
  await db.put('defectMarks', m);
}
export async function deleteDefectMark(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('defectMarks', id);
}
/** Plan samt Markierungen und Bild entfernen (Fotos bleiben in der Fotodokumentation) */
export async function deleteDefectPlanCompletely(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['defectPlans', 'defectMarks', 'defectPlanImages'], 'readwrite');
  for (const m of await tx.objectStore('defectMarks').index('planId').getAll(id)) await tx.objectStore('defectMarks').delete(m.id);
  await tx.objectStore('defectPlanImages').delete(id);
  await tx.objectStore('defectPlans').delete(id);
  await tx.done;
}

/* Eigene Firmenformulare */
export async function listFormTemplates(): Promise<FormTemplate[]> {
  return (await (await getDB()).getAll('formTemplates')).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'de'));
}
export async function getFormTemplate(id: string): Promise<FormTemplate | undefined> {
  return (await getDB()).get('formTemplates', id);
}
export async function saveFormTemplate(t: FormTemplate, pdf?: ArrayBuffer): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['formTemplates', 'formTemplateFiles'], 'readwrite');
  await tx.objectStore('formTemplates').put(t);
  if (pdf) await tx.objectStore('formTemplateFiles').put({ id: t.id, data: pdf });
  await tx.done;
}
export async function getFormTemplateFile(id: string): Promise<ArrayBuffer | undefined> {
  return (await (await getDB()).get('formTemplateFiles', id))?.data;
}
export async function deleteFormTemplate(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['formTemplates', 'formTemplateFiles'], 'readwrite');
  await tx.objectStore('formTemplates').delete(id);
  await tx.objectStore('formTemplateFiles').delete(id);
  await tx.done;
}
