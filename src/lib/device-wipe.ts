import { getAuth, type Session } from './auth';
import { deleteLocalDatabase, getMeta } from './db';
import { disconnectPhotoCloud } from './photo-cloud';

/**
 * Daten der Firma von diesem Gerät löschen: Projekte, Pläne, Fotos, Berichte, Einstellungen, Warteschlange – alles,
 * was die App auf dem Gerät hält (IndexedDB), dazu die App-Sperre und gemerkte Ansichten. Die Darstellung (Größe,
 * hell/dunkel) bleibt. Was noch nicht übertragen war, ist danach weg.
 *
 * Ausgelöst durch: „Abmelden und Daten löschen“ (Konto → Sicherheit), 10 falsche PINs an der App-Sperre, und
 * automatisch, wenn die Person nicht mehr zur Firma gehört (vom Admin gesperrt oder entfernt, oder jetzt in einer
 * anderen Firma) – sobald das Gerät wieder online ist und die Anmeldung geprüft hat.
 */
const KEEP = new Set(['uiSize', 'uiTheme']);
const WIPED = 'baupad.wiped';

export async function wipeDeviceData(opts: { signOut: boolean; reason?: string }): Promise<void> {
  disconnectPhotoCloud();
  if (opts.signOut) await getAuth().signOut().catch(() => {});
  await deleteLocalDatabase();
  try {
    for (const k of Object.keys(localStorage)) {
      // Anmeldung (sb-…) nur behalten, wenn nicht abgemeldet wird
      if (KEEP.has(k) || (!opts.signOut && k.startsWith('sb-'))) continue;
      localStorage.removeItem(k);
    }
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('baupad.')) sessionStorage.removeItem(k);
    sessionStorage.setItem(WIPED, opts.reason ?? 'Die Daten wurden von diesem Gerät gelöscht.');
  } catch {
    /* kein Speicher */
  }
}

/** nach dem Neuladen: Hinweis, warum gelöscht wurde (einmal) */
export function takeWipeNotice(): string | null {
  try {
    const m = sessionStorage.getItem(WIPED);
    sessionStorage.removeItem(WIPED);
    return m;
  } catch {
    return null;
  }
}

/**
 * Gehört die Person noch zur Firma, deren Daten auf dem Gerät liegen? Nur mit online geprüftem Kontext (offline ist
 * die Firma unbekannt). Liefert true, wenn gelöscht wurde (danach neu laden).
 */
export async function guardMembership(s: Session | null | undefined): Promise<boolean> {
  if (!s?.contextLoaded) return false;
  const synced = await getMeta<string>('dataSyncWorkspace').catch(() => undefined);
  if (!synced || synced === s.companyId) return false;
  await wipeDeviceData({
    signOut: false,
    reason: s.companyId
      ? 'Du bist jetzt in einer anderen Firma angemeldet – die Daten der bisherigen Firma wurden von diesem Gerät gelöscht.'
      : 'Dein Zugang zur Firma wurde beendet – die Daten der Firma wurden von diesem Gerät gelöscht.',
  });
  return true;
}
