import { useEffect, useState } from 'react';
import { getPhotoStorage } from '../lib/photo-storage';

/** Bild-Adressen (Vorschau bzw. Bild) – je Foto einmal erzeugt, bleiben für die Sitzung gültig */
const urls = new Map<string, string>();
export async function photoUrl(id: string, kind: 'thumb' | 'data'): Promise<string | null> {
  const key = `${kind}:${id}`;
  const u = urls.get(key);
  if (u) return u;
  const b = await getPhotoStorage().blobs(id);
  if (!b) return null;
  const url = URL.createObjectURL(new Blob([b[kind]], { type: 'image/jpeg' }));
  urls.set(key, url);
  return url;
}
export function forgetPhotoUrl(id: string) {
  for (const kind of ['thumb', 'data']) {
    const u = urls.get(`${kind}:${id}`);
    if (u) URL.revokeObjectURL(u);
    urls.delete(`${kind}:${id}`);
  }
}
export function usePhotoUrl(id: string, kind: 'thumb' | 'data'): string | null {
  const [src, setSrc] = useState<string | null>(() => urls.get(`${kind}:${id}`) ?? null);
  useEffect(() => {
    let on = true;
    setSrc(urls.get(`${kind}:${id}`) ?? null);
    void photoUrl(id, kind).then((u) => on && setSrc(u));
    return () => {
      on = false;
    };
  }, [id, kind]);
  return src;
}

/** Vorschaubild eines Fotos (grauer Platzhalter, bis es geladen ist) */
export function PhotoImg({ id, alt = '', className }: { id: string; alt?: string; className?: string }) {
  const src = usePhotoUrl(id, 'thumb');
  return src ? <img src={src} alt={alt} className={className} loading="lazy" /> : <span className={`photo-thumb-empty ${className ?? ''}`} />;
}
