import { deletePhotoCompletely, getPhotoBlob, listPhotos, putPhotoBlob, savePhoto } from './db';
import type { Photo } from './types';

/**
 * Speicher-Schnittstelle der Fotodokumentation. Die Fotoverwaltung (Seiten, Gruppierung, Suche) spricht nur
 * mit dieser Schnittstelle – nicht mit einem bestimmten Speicherort. So lässt sich die zentrale Ablage
 * (Cloud) später anbinden oder austauschen, ohne die Fotodokumentation neu zu entwickeln.
 *
 * Heute ist nur der lokale Adapter aktiv: Bilder liegen auf diesem Gerät, Status „nur auf diesem Gerät“.
 * Der Cloud-Adapter ist vorbereitet (Schnittstelle), aber noch mit keinem Dienst verbunden.
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

/**
 * Anbindung einer zentralen Ablage (Phase 3): Hochladen, Abrufen und Löschen über einen Dienst, der die
 * Berechtigung je Anfrage prüft und nur kurzlebige, geschützte Links ausgibt. Noch nicht verbunden.
 */
export interface CloudPhotoBackend {
  upload(photo: Photo, blobs: PhotoBlobs): Promise<{ remoteId: string }>;
  download(remoteId: string): Promise<PhotoBlobs>;
  remove(remoteId: string): Promise<void>;
  list(): Promise<Photo[]>;
}

let storage: PhotoStorage = new LocalPhotoStorage();

/** aktive Ablage (lokal, bis die zentrale Ablage angebunden ist) */
export const getPhotoStorage = () => storage;
export const setPhotoStorage = (s: PhotoStorage) => {
  storage = s;
};

/** Ist eine zentrale Ablage angebunden? (Phase 3) */
export const cloudConnected = () => storage.kind === 'cloud';
