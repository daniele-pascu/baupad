import { deletePhotoCompletely, getPhotoBlob, listPhotos, putPhotoBlob, savePhoto } from './db';
import type { Photo } from './types';

/**
 * Speicher-Schnittstelle der Fotodokumentation. Die Fotoverwaltung (Seiten, Gruppierung, Suche) spricht nur
 * mit dieser Schnittstelle – nicht mit einem bestimmten Speicherort. So lässt sich die zentrale Ablage
 * (Cloud) später anbinden oder austauschen, ohne die Fotodokumentation neu zu entwickeln.
 *
 * Lokaler Adapter: Bilder liegen nur auf diesem Gerät (ohne Firma/Arbeitsbereich oder ohne eingerichtete Ablage).
 * Cloud-Adapter (photo-cloud.ts): Gerät als Zwischenspeicher, Upload-Warteschlange und Abgleich mit der
 * zentralen Ablage (Hetzner Object Storage über die Supabase-Funktion „storage“).
 */

export interface PhotoBlobs {
  data: ArrayBuffer;
  thumb: ArrayBuffer;
  original?: ArrayBuffer;
}

export interface PhotoStorage {
  /** Kennung der Ablage (Anzeige) */
  readonly kind: 'local' | 'cloud';
  /** Foto samt Bilddaten ablegen (neu oder aktualisiert) */
  put(photo: Photo, blobs: PhotoBlobs): Promise<Photo>;
  /** Angaben ändern (Beschreibung usw.) */
  update(photo: Photo): Promise<Photo>;
  /** Bilddaten laden (verkleinert bzw. Vorschau) */
  blobs(id: string): Promise<PhotoBlobs | undefined>;
  /** Foto endgültig entfernen */
  remove(id: string): Promise<void>;
  /** alle Fotos, auf die dieses Gerät/Benutzer Zugriff hat */
  list(): Promise<Photo[]>;
}

/** Lokaler Adapter: Browser-Datenbank dieses Geräts */
export class LocalPhotoStorage implements PhotoStorage {
  readonly kind = 'local' as const;
  async put(photo: Photo, blobs: PhotoBlobs): Promise<Photo> {
    const p: Photo = { ...photo, sync: 'local', updatedAt: Date.now() };
    await putPhotoBlob({ id: p.id, data: blobs.data, thumb: blobs.thumb, ...(blobs.original ? { original: blobs.original } : {}) });
    await savePhoto(p);
    return p;
  }
  async update(photo: Photo): Promise<Photo> {
    const p = { ...photo, updatedAt: Date.now() };
    await savePhoto(p);
    return p;
  }
  blobs(id: string) {
    return getPhotoBlob(id);
  }
  remove(id: string) {
    return deletePhotoCompletely(id);
  }
  list() {
    return listPhotos();
  }
}

let storage: PhotoStorage = new LocalPhotoStorage();

/** aktive Ablage (lokal, bis die zentrale Ablage angebunden ist) */
export const getPhotoStorage = () => storage;
export const setPhotoStorage = (s: PhotoStorage) => {
  storage = s;
};

/** Ist eine zentrale Ablage angebunden? */
export const cloudConnected = () => storage.kind === 'cloud';

/** Fotos haben sich im Hintergrund geändert (Abgleich mit der Ablage) – Seiten laden neu */
const EVT = 'baupad:photos';
export const notifyPhotosChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
};
export function onPhotosChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
