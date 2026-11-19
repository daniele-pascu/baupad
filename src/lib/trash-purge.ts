import { purgeDeleted } from './db';
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
  const touched = await purgeDeleted(now - TRASH_DAYS * DAY);
  const open = getState().projectId;
  if (open && touched.has(open) && !hasUnsavedChanges()) await reloadProject();
  return touched.size;
}
