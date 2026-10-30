import { useEffect, useState } from 'react';
import { cloudCall, CloudError, type FetchLike } from './cloud';
import { deletePhotoBlob, deletePhotoCompletely, getMeta, getPhoto, getPhotoBlob, listAllPhotos, listPhotos, putPhotoBlob, savePhoto, setMeta } from './db';
import { getPhotoStorage, LocalPhotoStorage, notifyPhotosChanged, type PhotoBlobs, type PhotoStorage, setPhotoStorage } from './photo-storage';
import type { Photo } from './types';

/**
 * Cloud-Adapter der Fotodokumentation: Das Gerät bleibt Zwischenspeicher (offline-fähig), jede Änderung
 * kommt in eine Warteschlange und wird bei Verbindung zur zentralen Ablage übertragen:
 *   put/update → Eintrag „wartet auf Upload“ → Bilddaten per signiertem Link zu Hetzner → Verzeichnis (Tabelle photos)
 *   remove     → Eintrag vorgemerkt → Verzeichnis (gelöscht) + Dateien löschen → lokal entfernen
 *   pull       → geänderte Einträge anderer Geräte seit dem letzten Abgleich; Bilder werden beim Öffnen nachgeladen
 * Lokale, noch nicht übertragene Änderungen gewinnen gegenüber dem Abgleich; sonst gilt der Stand des Servers.
 */

const SYNC_AT = 'photoSyncAt';
const ACTIVE = 'photoCloudActive';
const PULL_EVERY = 5 * 60_000;
const PAGE = 500;

type Part = 'data' | 'thumb' | 'original';
const keyOf = (id: string, part: Part) => `photos/${id}/${part}.jpg`;
const remoteIdOf = (id: string) => `photos/${id}`;

interface RemoteRow {
  id: string;
  data: Record<string, unknown>;
  size: number;
  has_original: boolean;
  uploaded: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface CloudState {
  /** off = keine Firma/abgemeldet · setup = Ablage nicht eingerichtet · connecting · ready · error */
  status: 'off' | 'setup' | 'connecting' | 'ready' | 'error';
  message: string | null;
  /** Fotos, die noch nicht (vollständig) übertragen sind */
  pending: number;
  lastSyncAt: number | null;
  busy: boolean;
}

let state: CloudState = { status: 'off', message: null, pending: 0, lastSyncAt: null, busy: false };
const listeners = new Set<(s: CloudState) => void>();
function setState(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb(state);
}
export const cloudState = () => state;
export function onCloudChange(cb: (s: CloudState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function useCloudState(): CloudState {
  const [s, setS] = useState(state);
  useEffect(() => onCloudChange(setS), []);
  return s;
}

/** Angaben eines Fotos ohne Gerätezustand – so stehen sie im Verzeichnis der Ablage */
function remoteData(p: Photo): Record<string, unknown> {
  const { sync: _s, syncError: _e, remoteId: _r, companyId: _c, deletedAt: _d, updatedAt: _u, ...rest } = p;
  return rest;
}

/** noch nicht übertragene lokale Änderung? */
const pendingLocal = (p: Photo) => p.sync === 'queued' || p.sync === 'failed' || (p.sync === 'uploading' && !p.remoteId);

export class CloudPhotoStorage implements PhotoStorage {
  readonly kind = 'cloud' as const;
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopFns: (() => void)[] = [];

  constructor(
    readonly companyId: string,
    private fetchFn?: FetchLike,
  ) {}

  private call<T>(action: string, body: Record<string, unknown> = {}) {
    return cloudCall<T>(action, body, this.fetchFn);
  }

  /** Hintergrund: regelmäßiger Abgleich, bei Wiederverbindung und beim Zurückkehren in die App */
  start() {
    const onOnline = () => void this.sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    this.timer = setInterval(() => void this.sync(), PULL_EVERY);
    this.stopFns.push(() => window.removeEventListener('online', onOnline), () => document.removeEventListener('visibilitychange', onVisible), () => clearInterval(this.timer));
  }
  stop() {
    for (const f of this.stopFns) f();
    this.stopFns = [];
  }

  async put(photo: Photo, blobs: PhotoBlobs): Promise<Photo> {
    const p: Photo = { ...photo, companyId: this.companyId, sync: 'queued', syncError: undefined, updatedAt: Date.now() };
    await putPhotoBlob({ id: p.id, data: blobs.data, thumb: blobs.thumb, ...(blobs.original ? { original: blobs.original } : {}) });
    await savePhoto(p);
    this.kick();
    return p;
  }

  async update(photo: Photo): Promise<Photo> {
    const p: Photo = { ...photo, companyId: this.companyId, sync: 'queued', syncError: undefined, updatedAt: Date.now() };
    await savePhoto(p);
    this.kick();
    return p;
  }

  /** Bilddaten vom Gerät – sonst aus der Ablage nachladen und auf dem Gerät behalten */
  async blobs(id: string): Promise<PhotoBlobs | undefined> {
    const local = await getPhotoBlob(id);
    if (local) return local;
    const p = await getPhoto(id);
    if (!p?.remoteId) return undefined;
    const parts: Part[] = p.original ? ['data', 'thumb', 'original'] : ['data', 'thumb'];
    const { urls } = await this.call<{ urls: Record<string, string> }>('presign', { items: parts.map((part) => ({ key: keyOf(id, part), method: 'GET' })) });
    const get = async (part: Part) => {
      const r = await fetch(urls[`GET ${keyOf(id, part)}`]);
      if (!r.ok) throw new CloudError(r.status, 'download', `Bild konnte nicht geladen werden (${r.status}).`);
      return r.arrayBuffer();
    };
    const [data, thumb] = await Promise.all([get('data'), get('thumb')]);
    const original = p.original ? await get('original').catch(() => undefined) : undefined;
    await putPhotoBlob({ id, data, thumb, ...(original ? { original } : {}) });
    return { data, thumb, ...(original ? { original } : {}) };
  }

  /** zum Löschen vormerken – aus der Liste sofort weg, Ablage und Gerät werden im Hintergrund bereinigt */
  async remove(id: string): Promise<void> {
    const p = await getPhoto(id);
    if (!p) return;
    await deletePhotoBlob(id);
    await savePhoto({ ...p, deletedAt: Date.now(), sync: 'queued', syncError: undefined, updatedAt: Date.now() });
    this.kick();
  }

  list() {
    return listPhotos();
  }

  /** Fotos aus der Zeit ohne Firma/Ablage in die Warteschlange nehmen */
  async adoptLocal(): Promise<number> {
    const all = await listAllPhotos();
    let n = 0;
    for (const p of all) {
      if (p.sync === 'local' && (!p.companyId || p.companyId === this.companyId)) {
        await savePhoto({ ...p, companyId: this.companyId, sync: 'queued', syncError: undefined });
        n++;
      }
    }
    return n;
  }

  private kick() {
    void this.flush().catch(() => {});
  }

  /** Abgleich in beide Richtungen (Warteschlange abarbeiten, dann Änderungen anderer Geräte holen) */
  async sync(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    await this.flush();
    await this.pull();
  }

  /** Warteschlange abarbeiten – läuft nie doppelt; ein Aufruf währenddessen hängt einen weiteren Durchlauf an */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.again = false;
          await this.flushOnce();
        } while (this.again);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const todo = (await listAllPhotos()).filter(pendingLocal);
    await this.refreshPending(todo.length);
    if (!todo.length) return;
    setState({ busy: true });
    let changed = false;
    try {
      for (const p of todo) {
        try {
          if (p.deletedAt) await this.pushDelete(p);
          else await this.pushPhoto(p);
          changed = true;
        } catch (e) {
          changed = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (!p.deletedAt) await savePhoto({ ...(await getPhoto(p.id)) ?? p, sync: 'failed', syncError: msg });
          if (e instanceof CloudError && (e.offline || e.status === 401 || e.notConfigured)) {
            setState({ status: e.notConfigured ? 'setup' : state.status, message: msg });
            break; // ohne Verbindung bringt der nächste Versuch nichts – später erneut
          }
        }
      }
    } finally {
      setState({ busy: false });
      await this.refreshPending();
      if (changed) notifyPhotosChanged();
    }
  }

  private async pushPhoto(p: Photo): Promise<void> {
    let remoteId = p.remoteId;
    if (!remoteId) {
      await savePhoto({ ...p, sync: 'uploading', syncError: undefined });
      const blobs = await getPhotoBlob(p.id);
      if (!blobs) throw new Error('Bilddaten fehlen auf diesem Gerät.');
      const parts: Part[] = blobs.original ? ['data', 'thumb', 'original'] : ['data', 'thumb'];
      const { urls } = await this.call<{ urls: Record<string, string> }>('presign', { items: parts.map((part) => ({ key: keyOf(p.id, part), method: 'PUT', contentType: 'image/jpeg' })) });
      for (const part of parts) {
        const body = part === 'data' ? blobs.data : part === 'thumb' ? blobs.thumb : blobs.original!;
        let r: Response;
        try {
          r = await fetch(urls[`PUT ${keyOf(p.id, part)}`], { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body });
        } catch {
          throw new CloudError(0, 'offline', 'Upload abgebrochen – keine Verbindung.');
        }
        if (!r.ok) throw new Error(`Upload fehlgeschlagen (${r.status}).`);
      }
      remoteId = remoteIdOf(p.id);
    }
    const current = (await getPhoto(p.id)) ?? p; // Beschreibung könnte sich während des Uploads geändert haben
    await this.call('upsert', { photos: [{ id: p.id, data: remoteData(current), size: current.size, has_original: current.original, uploaded: true }] });
    await savePhoto({ ...current, remoteId, sync: 'synced', syncError: undefined });
  }

  private async pushDelete(p: Photo): Promise<void> {
    await this.call('upsert', { photos: [{ id: p.id, data: remoteData(p), size: p.size, has_original: p.original, uploaded: Boolean(p.remoteId), deleted_at: p.deletedAt }] });
    if (p.remoteId) {
      const parts: Part[] = p.original ? ['data', 'thumb', 'original'] : ['data', 'thumb'];
      await this.call('delete', { keys: parts.map((part) => keyOf(p.id, part)) }).catch(() => {
        /* Dateien bleiben verwaist – Eintrag ist gelöscht; Aufräumen später */
      });
    }
    await deletePhotoCompletely(p.id);
  }

  /** Änderungen anderer Geräte seit dem letzten Abgleich übernehmen */
  async pull(): Promise<void> {
    let since = (await getMeta<string>(SYNC_AT)) ?? null;
    let changed = false;
    for (;;) {
      const { photos, now } = await this.call<{ photos: RemoteRow[]; now: string }>('pull', { since });
      for (const row of photos) {
        const local = await getPhoto(row.id);
        if (local && pendingLocal(local)) continue;
        if (row.deleted_at) {
          if (local) {
            await deletePhotoCompletely(row.id);
            changed = true;
          }
          continue;
        }
        const data = row.data as unknown as Photo;
        const p: Photo = {
          ...data,
          id: row.id,
          companyId: this.companyId,
          size: row.size || data.size || 0,
          original: row.has_original,
          remoteId: remoteIdOf(row.id),
          sync: row.uploaded ? 'synced' : 'uploading',
          syncError: undefined,
          deletedAt: null,
          updatedAt: Date.parse(row.updated_at) || Date.now(),
        };
        await savePhoto(p);
        changed = true;
      }
      if (photos.length < PAGE) {
        await setMeta(SYNC_AT, now);
        break;
      }
      since = photos[photos.length - 1].updated_at;
      await setMeta(SYNC_AT, since);
    }
    setState({ status: 'ready', message: null, lastSyncAt: Date.now() });
    if (changed) notifyPhotosChanged();
  }

  private async refreshPending(n?: number) {
    setState({ pending: n ?? (await listAllPhotos()).filter(pendingLocal).length });
  }
}

let active: CloudPhotoStorage | null = null;

/**
 * Ablage je nach Anmeldung anbinden: mit Firma (Arbeitsbereich) wird der Cloud-Adapter aktiv; ohne Firma oder
 * nach dem Abmelden gilt wieder der lokale Speicher. Der erste Abgleich prüft, ob die Ablage eingerichtet ist –
 * war sie es schon einmal, läuft der Adapter auch offline los (Warteschlange) und gleicht später ab.
 */
export async function connectPhotoCloud(companyId: string | null | undefined, fetchFn?: FetchLike): Promise<void> {
  if (!companyId) {
    disconnectPhotoCloud();
    return;
  }
  if (active?.companyId === companyId) return;
  disconnectPhotoCloud();
  const storage = new CloudPhotoStorage(companyId, fetchFn);
  const known = (await getMeta<string>(ACTIVE)) === companyId;
  setState({ status: 'connecting', message: null });
  if (!known) {
    try {
      await storage.pull();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: e instanceof CloudError && e.notConfigured ? 'setup' : e instanceof CloudError && e.code === 'no-workspace' ? 'off' : 'error', message: msg });
      return;
    }
    await setMeta(ACTIVE, companyId);
  }
  active = storage;
  setPhotoStorage(storage);
  storage.start();
  await storage.adoptLocal();
  notifyPhotosChanged(); // Seiten, die vor der Anbindung geladen haben, holen Bilder jetzt aus der Ablage
  setState({ status: known ? state.status === 'connecting' ? 'ready' : state.status : 'ready' });
  void storage.sync().catch(() => {});
}

export function disconnectPhotoCloud() {
  if (active) {
    active.stop();
    active = null;
  }
  if (getPhotoStorage().kind === 'cloud') setPhotoStorage(new LocalPhotoStorage());
  setState({ status: 'off', message: null, pending: 0, busy: false });
}

/** „Jetzt abgleichen“ (Konto) */
export async function syncPhotoCloud(): Promise<void> {
  if (!active) throw new CloudError(0, 'off', 'Die zentrale Ablage ist nicht angebunden.');
  await active.sync();
}

/** Ablage erneut anbinden (z. B. nach dem Einrichten) */
export async function retryPhotoCloud(companyId: string, fetchFn?: FetchLike): Promise<void> {
  await setMeta(ACTIVE, null);
  disconnectPhotoCloud();
  await connectPhotoCloud(companyId, fetchFn);
}
