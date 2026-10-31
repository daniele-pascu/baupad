import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { deleteProjectCompletely, getBlob, getDB, getMeta, loadProjectData, notifyLocalChange, outboxEntry, setMeta } from './db';
import { getDeviceId, uuid } from './ids';
import { safeFileName, type ExportFile } from './aufmass';
import { todayIso } from './numbers';
import type { Component, CostCenter, Damage, DrawElement, LvDocument, Plan, Project, Report, SourceFile } from './types';

/**
 * Projektsicherung als ZIP-Datei: vollständiger Projektstand inklusive Originaldateien.
 * Damit lässt sich ein Projekt sichern oder auf ein anderes Gerät übertragen.
 */

const FORMAT = 'schadstellen-aufmass-projekt';
const VERSION = 1;

export interface BackupContent {
  manifest: { format: string; version: number; exportedAt: number; deviceId: string; app: string };
  project: Project;
  costCenters: CostCenter[];
  files: SourceFile[];
  plans: Plan[];
  damages: Damage[];
  /** ab BauPad-Datenbankversion 2; fehlt in älteren Sicherungen */
  components: Component[];
  /** ab BauPad-Datenbankversion 3 (gezeichnete Pläne); fehlt in älteren Sicherungen */
  elements: DrawElement[];
  /** ab Datenbankversion 4 (LV/MFK); fehlt in älteren Sicherungen */
  lvDocs: LvDocument[];
  /** ab Datenbankversion 6 (Berichte & Formulare des Projekts); fehlt in älteren Sicherungen */
  reports?: Report[];
  blobs: Map<string, Uint8Array>;
}

export async function exportProjectBackup(projectId: string): Promise<ExportFile> {
  const data = await loadProjectData(projectId);
  if (!data) throw new Error('Projekt nicht gefunden.');
  const zipFiles: Record<string, Uint8Array> = {};
  const manifest = { format: FORMAT, version: VERSION, exportedAt: Date.now(), deviceId: getDeviceId(), app: 'BauPad' };
  zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  zipFiles['projekt.json'] = strToU8(
    JSON.stringify(
      {
        project: data.project,
        costCenters: data.costCenters,
        files: data.files,
        plans: data.plans,
        damages: data.damages,
        components: data.components,
        elements: data.elements,
        lvDocs: data.lvDocs,
        reports: (await (await getDB()).getAllFromIndex('reports', 'projectId', projectId)) ?? [],
      },
      null,
      1,
    ),
  );
  for (const f of data.files) {
    if (f.deletedAt) continue;
    const blob = await getBlob(f.id);
    if (!blob) throw new Error(`Originaldatei „${f.name}“ fehlt im Gerätespeicher.`);
    zipFiles[`dateien/${f.id}`] = new Uint8Array(blob);
  }
  // Originaldateien (PDF/JPG/PNG) sind bereits komprimiert
  const zipped = zipSync(zipFiles, { level: 0 });
  await setMeta(`lastBackup:${projectId}`, Date.now());
  return {
    name: `${safeFileName(data.project.name, 'Sicherung', todayIso())}.zip`,
    data: zipped,
    mimeType: 'application/zip',
  };
}

export async function readProjectBackup(file: Blob): Promise<BackupContent> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('Die Datei ist keine gültige Projektsicherung (ZIP-Datei erwartet).');
  }
  if (!entries['manifest.json'] || !entries['projekt.json']) {
    throw new Error('Die Datei ist keine Projektsicherung von BauPad.');
  }
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  if (manifest.format !== FORMAT) throw new Error('Unbekanntes Dateiformat.');
  if (manifest.version > VERSION) throw new Error('Die Sicherung stammt aus einer neueren App-Version. Bitte App aktualisieren.');
  const content = JSON.parse(strFromU8(entries['projekt.json']));
  const blobs = new Map<string, Uint8Array>();
  for (const f of content.files as SourceFile[]) {
    if (f.deletedAt) continue;
    const b = entries[`dateien/${f.id}`];
    if (!b) throw new Error(`Die Sicherung ist unvollständig: Datei „${f.name}“ fehlt.`);
    blobs.set(f.id, b);
  }
  if (!content.project?.id || !content.project?.name) throw new Error('Die Sicherung enthält keine gültigen Projektdaten.');
  return { manifest, ...content, blobs };
}

export async function findExistingProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  const p = await db.get('projects', id);
  return p && !p.deletedAt ? p : undefined;
}

/**
 * Importiert eine Sicherung.
 * - 'replace': vorhandenes Projekt mit gleicher Kennung wird ersetzt
 * - 'copy': Import als neues, unabhängiges Projekt (neue Kennungen)
 */
export async function importProjectBackup(content: BackupContent, mode: 'replace' | 'copy'): Promise<string> {
  let { project, costCenters, files, plans, damages } = content;
  let components = content.components ?? [];
  let elements = content.elements ?? [];
  let lvDocs = content.lvDocs ?? [];
  let reports = content.reports ?? [];
  let blobs = content.blobs;
  if (mode === 'copy') {
    const ids = new Map<string, string>();
    const remap = (id: string) => {
      let n = ids.get(id);
      if (!n) ids.set(id, (n = uuid()));
      return n;
    };
    project = { ...project, id: remap(project.id), name: `${project.name} (Kopie)`, rev: 1, updatedAt: Date.now() };
    costCenters = costCenters.map((c) => ({ ...c, id: remap(c.id), projectId: project.id }));
    files = files.map((f) => ({ ...f, id: remap(f.id), projectId: project.id }));
    // Gezeichnete Pläne haben keine Datei (fileId = '') – leere Kennung nicht umschreiben
    plans = plans.map((p) => ({ ...p, id: remap(p.id), projectId: project.id, costCenterId: remap(p.costCenterId), fileId: p.fileId ? remap(p.fileId) : p.fileId }));
    elements = elements.map((e) => ({ ...e, id: remap(e.id), projectId: project.id, planId: remap(e.planId) }));
    lvDocs = lvDocs.map((l) => ({ ...l, id: remap(l.id), projectId: project.id }));
    reports = reports.map((r) => ({ ...r, id: remap(r.id), projectId: project.id }));
    components = components.map((c) => ({ ...c, id: remap(c.id), projectId: project.id, planId: remap(c.planId) }));
    damages = damages.map((d) => ({
      ...d,
      id: remap(d.id),
      projectId: project.id,
      planId: remap(d.planId),
      componentId: d.componentId ? remap(d.componentId) : d.componentId,
      // Positionsverweis „Dokument:Position“ – nur die Dokumentkennung ändert sich
      positionRef: d.positionRef ? `${remap(d.positionRef.split(':')[0])}:${d.positionRef.split(':')[1]}` : d.positionRef,
    }));
    blobs = new Map([...blobs].map(([k, v]) => [remap(k), v]));
  } else {
    await deleteProjectCompletely(project.id);
  }
  const db = await getDB();
  const tx = db.transaction(['projects', 'costCenters', 'files', 'blobs', 'plans', 'damages', 'components', 'elements', 'lvDocs', 'reports', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  // jeder wiederhergestellte Datensatz wird für den Abgleich mit der Ablage vorgemerkt
  const put = async <S extends 'costCenters' | 'files' | 'plans' | 'damages' | 'components' | 'elements' | 'lvDocs'>(store: S, rec: { id: string; rev: number; updatedAt: number }) => {
    await tx.objectStore(store).put(rec as never);
    await outbox.put(outboxEntry(store, rec.id, project.id, { rev: rec.rev, updatedAt: rec.updatedAt }));
  };
  await tx.objectStore('projects').put(project);
  await outbox.put(outboxEntry('projects', project.id, project.id, { rev: project.rev, updatedAt: project.updatedAt }));
  for (const c of costCenters) await put('costCenters', c);
  for (const f of files) await put('files', f);
  for (const p of plans) await put('plans', p);
  for (const d of damages) await put('damages', d);
  for (const c of components) await put('components', c);
  for (const e of elements) await put('elements', e);
  for (const l of lvDocs) await put('lvDocs', l);
  // Berichte: ergänzen bzw. aktualisieren (neuerer Stand gewinnt) – vorhandene werden nie gelöscht
  for (const r of reports) {
    const cur = await tx.objectStore('reports').get(r.id);
    if (!cur || cur.updatedAt < r.updatedAt) {
      await tx.objectStore('reports').put(r);
      await outbox.put(outboxEntry('reports', r.id, project.id, { updatedAt: r.updatedAt }));
    }
  }
  for (const [id, data] of blobs) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await tx.objectStore('blobs').put({ id, projectId: project.id, data: buf });
    await outbox.put(outboxEntry('blobs', id, project.id));
  }
  await tx.done;
  notifyLocalChange();
  return project.id;
}

// ---------------------------------------------------------------------------
// Sicherungs-Erinnerung (Browser-Speicher ist keine garantierte Datensicherung)

/** Nach so vielen Tagen ohne Sicherung wird bei geänderten Projekten erinnert. */
export const BACKUP_REMIND_DAYS = 3;

/** Erinnerung fällig: seit der letzten Sicherung geändert und diese älter als die Frist (bzw. nie gesichert). */
export function isBackupDue(lastEdit: number, lastBackup: number | null, createdAt: number, now = Date.now()): boolean {
  if (lastBackup !== null && lastEdit <= lastBackup) return false;
  return now - (lastBackup ?? createdAt) > BACKUP_REMIND_DAYS * 86_400_000;
}

export interface BackupStatus {
  lastBackup: number | null;
  lastEdit: number;
  due: boolean;
}

export async function backupStatus(project: Pick<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<BackupStatus> {
  const lastBackup = (await getMeta<number>(`lastBackup:${project.id}`)) ?? null;
  const lastEdit = Math.max(project.updatedAt, (await getMeta<number>(`lastEdit:${project.id}`)) ?? 0);
  return { lastBackup, lastEdit, due: isBackupDue(lastEdit, lastBackup, project.createdAt) };
}
