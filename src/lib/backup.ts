import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { deleteProjectCompletely, getBlob, getDB, loadProjectData } from './db';
import { getDeviceId, uuid } from './ids';
import { safeFileName, type ExportFile } from './aufmass';
import { todayIso } from './numbers';
import type { Component, CostCenter, Damage, DrawElement, Plan, Project, SourceFile } from './types';

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
    components = components.map((c) => ({ ...c, id: remap(c.id), projectId: project.id, planId: remap(c.planId) }));
    damages = damages.map((d) => ({
      ...d,
      id: remap(d.id),
      projectId: project.id,
      planId: remap(d.planId),
      componentId: d.componentId ? remap(d.componentId) : d.componentId,
    }));
    blobs = new Map([...blobs].map(([k, v]) => [remap(k), v]));
  } else {
    await deleteProjectCompletely(project.id);
  }
  const db = await getDB();
  const tx = db.transaction(['projects', 'costCenters', 'files', 'blobs', 'plans', 'damages', 'components', 'elements'], 'readwrite');
  await tx.objectStore('projects').put(project);
  for (const c of costCenters) await tx.objectStore('costCenters').put(c);
  for (const f of files) await tx.objectStore('files').put(f);
  for (const p of plans) await tx.objectStore('plans').put(p);
  for (const d of damages) await tx.objectStore('damages').put(d);
  for (const c of components) await tx.objectStore('components').put(c);
  for (const e of elements) await tx.objectStore('elements').put(e);
  for (const [id, data] of blobs) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await tx.objectStore('blobs').put({ id, projectId: project.id, data: buf });
  }
  await tx.done;
  return project.id;
}
