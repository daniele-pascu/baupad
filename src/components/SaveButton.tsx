import { useEffect, useRef, useState } from 'react';
import { dataSyncState, syncData, useDataSyncState } from '../lib/data-sync';
import { cloudState, syncPhotoCloud, useCloudState } from '../lib/photo-cloud';
import { navigate, paths } from '../lib/router';
import { flush, reloadProject, useAppState } from '../lib/store';
import { Icon } from './Icon';
import { showError, toast } from './ui';

/** Empfang des Geräts (online/offline-Ereignisse des Browsers) */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/** „Speichert …“ mindestens so lange zeigen – kurze Speichervorgänge sollen nicht flackern */
const MIN_BUSY = 700;

type Look = 'saved' | 'local' | 'saving' | 'error';

/**
 * Speicher-Taste oben in der Leiste (alle Tools, Projekte, Tool-Übersicht). Sie zeigt immer, wo die Daten stehen:
 * „Gespeichert“ (online), „Lokal gesichert“ (auf dem Gerät, wartet auf Upload bzw. ohne Empfang oder ohne Firmen-Ablage)
 * oder „Speichert …“. Antippen speichert sofort: lokal schreiben, hochladen, Neues holen – mit Ladezeichen.
 * data-status = Speicherstand des offenen Aufmaß-Projekts (wie bisher), data-state = was die Taste zeigt.
 */
export function SaveButton() {
  const data = useDataSyncState();
  const photos = useCloudState();
  const online = useOnline();
  const save = useAppState((s) => s.save);
  const [manual, setManual] = useState(false);

  const cloudOn = data.status !== 'off' || photos.status !== 'off';
  const waiting = data.pending + photos.pending;
  const storeBusy = save.status === 'pending' || save.status === 'saving';
  const storeError = save.status === 'error' || save.status === 'conflict';
  const failure = online && (data.status === 'error' || photos.status === 'error' || photos.status === 'setup') ? ((data.status === 'error' ? data.message : photos.message) ?? '') : null;
  const uploading = online && waiting > 0 && (data.busy || photos.busy);
  const busy = useSticky(manual || storeBusy || uploading, MIN_BUSY);

  const look: Look = storeError || failure !== null ? 'error' : busy ? 'saving' : !cloudOn || !online || waiting > 0 ? 'local' : 'saved';
  const label =
    look === 'error' ? (storeError ? 'Nicht gespeichert' : 'Online-Fehler') : look === 'saving' ? 'Speichert …' : look === 'local' ? 'Lokal gesichert' : 'Gespeichert';
  const title =
    look === 'error'
      ? storeError
        ? (save.error ?? 'Speichern fehlgeschlagen')
        : failure || 'Online-Speichern fehlgeschlagen – antippen für Details'
      : look === 'saving'
        ? 'Wird gespeichert …'
        : look === 'local'
          ? !cloudOn
            ? 'Auf diesem Gerät gespeichert – ohne Firmen-Ablage wird nichts hochgeladen.'
            : !online
              ? `Kein Empfang: auf dem Gerät gespeichert${waiting ? ` (${waiting} warten)` : ''} – wird automatisch hochgeladen, sobald wieder Empfang da ist.`
              : `Auf dem Gerät gespeichert, ${waiting} ${waiting === 1 ? 'wartet' : 'warten'} auf Upload – antippen lädt sofort hoch.`
          : 'Alles online gespeichert – antippen gleicht sofort ab.';

  // gerade fertig: kurzer Haken (nach einem Speichern, nicht beim Öffnen der Seite)
  const prev = useRef(look);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = look;
    if (was !== 'saving' || (look !== 'saved' && look !== 'local')) return;
    setDone(true);
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [look]);

  const press = async () => {
    if (manual) return;
    if (save.status === 'conflict') return void reloadProject();
    setManual(true);
    try {
      await flush(); // Aufmaß: ausstehende Änderungen sofort auf das Gerät schreiben
      if (!cloudOn) toast('Auf diesem Gerät gespeichert – ohne Firmen-Ablage wird nichts hochgeladen.', 'info');
      else if (!online) toast('Kein Empfang – lokal gesichert. Wird automatisch hochgeladen, sobald wieder Empfang da ist.', 'info', 5000);
      else {
        // Fotos und Daten hochladen, danach Neues von den anderen Geräten holen
        if (photos.status === 'ready' || photos.status === 'error') await syncPhotoCloud().catch(() => syncData());
        else await syncData();
      }
    } catch (e) {
      showError(e, 'Hochladen fehlgeschlagen');
    } finally {
      setManual(false);
    }
    // Online-Ablage weiter fehlerhaft: Konto zeigt die Meldung und was zu tun ist
    const d = dataSyncState();
    const c = cloudState();
    if (!storeError && navigator.onLine !== false && (d.status === 'error' || c.status === 'error' || c.status === 'setup')) navigate(paths.accountSection('app'));
  };

  return (
    <button
      type="button"
      className={`save-btn ${look}${done ? ' done' : ''}${online ? '' : ' offline'}`}
      onClick={() => void press()}
      title={title}
      aria-label={`${label} – ${title}`}
      aria-live="polite"
      data-testid="save-status"
      data-status={save.status}
      data-state={look}
      data-waiting={waiting}
      data-online={online ? '1' : '0'}
    >
      <span className="save-btn-mark" aria-hidden="true">
        {look === 'saving' ? <span className="save-btn-spin" /> : done ? <Icon name="check" size={14} /> : <span className="save-btn-dot" />}
      </span>
      <span className="save-btn-label">{label}</span>
    </button>
  );
}

/** true bleibt mindestens `ms` lang stehen (gegen Flackern) */
function useSticky(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(on);
  const since = useRef(0);
  useEffect(() => {
    if (on) {
      since.current = Date.now();
      setShown(true);
      return;
    }
    const rest = since.current + ms - Date.now();
    if (rest <= 0) return setShown(false);
    const t = setTimeout(() => setShown(false), rest);
    return () => clearTimeout(t);
  }, [on, ms]);
  return shown;
}
