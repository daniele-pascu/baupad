import { getDB, purgeDeleted } from './db';
import { getPhotoStorage } from './photo-storage';
import { getState, hasUnsavedChanges, reloadProject } from './store';

/** Gelöschtes bleibt so lange im Papierkorb, danach wird es endgültig gelöscht */
export const TRASH_DAYS = 15;
export const DAY = 24 * 60 * 60 * 1000;

/**
 * Abgelaufenes endgültig löschen (älter als 15 Tage) – auf diesem Gerät, in der Ablage und damit auf allen Geräten.
 * Mit Online-Ablage erst nach einem Abgleich aufrufen – sonst könnte ein Gerät mit altem Stand etwas löschen, das
 * inzwischen auf einem anderen Gerät wiederhergestellt wurde.
 */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const before = now - TRASH_DAYS * DAY;
  const db = await getDB();
  // ganze Projekte: wie früher „Projekt löschen“ – in allen Tools, Fotos samt Dateien, für alle Geräte
  const projects = (await db.getAll('projects')).filter((p) => p.deletedAt && p.deletedAt < before);
  if (projects.length) {
    const { deleteProjectEverywhere } = await import('./sites');
    for (const p of projects) await deleteProjectEverywhere(p.id);
  }
  // Fotos: Eintrag und Dateien (Fotos mit noch nicht übertragener Änderung erst nach dem Upload)
  let photos = 0;
  for (const ph of await db.getAll('photos')) {
    if (ph.deletedAt || !ph.trashedAt || ph.trashedAt >= before || ph.sync === 'queued' || ph.sync === 'uploading') continue;
    await getPhotoStorage().remove(ph.id);
    photos++;
  }
  const touched = await purgeDeleted(before);
  const open = getState().projectId;
  if (open && touched.has(open) && !hasUnsavedChanges()) await reloadProject();
  return touched.size + projects.length + photos;
}
