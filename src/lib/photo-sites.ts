import { getMeta, setMeta } from './db';
import type { PhotoSite } from './types';

const KEY = 'photoSites';

/** Unter „Fotos“ frei angelegte Baustellen (ohne Projekt) – auf diesem Gerät gespeichert */
export async function listFreePhotoSites(): Promise<PhotoSite[]> {
  const list = (await getMeta<PhotoSite[]>(KEY)) ?? [];
  return list.map((s) => ({ projectId: null, name: s.name, number: s.number ?? '', address: s.address ?? '' }));
}

/** Baustelle anlegen (Name Pflicht; gleicher Name = dieselbe Baustelle) */
export async function addFreePhotoSite(site: { name: string; number?: string; address?: string }): Promise<PhotoSite> {
  const name = site.name.trim();
  if (!name) throw new Error('Bitte einen Namen für die Baustelle eingeben.');
  const next: PhotoSite = { projectId: null, name, number: site.number?.trim() ?? '', address: site.address?.trim() ?? '' };
  const list = await listFreePhotoSites();
  const i = list.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) list[i] = { ...list[i], number: next.number || list[i].number, address: next.address || list[i].address };
  else list.push(next);
  await setMeta(KEY, list);
  return i >= 0 ? list[i] : next;
}
