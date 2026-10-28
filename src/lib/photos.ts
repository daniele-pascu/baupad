import { isoDate, isoWeekNo, parseDate, weekOf } from './crew';
import type { Photo, PhotoSync } from './types';

/**
 * Fotodokumentation – Grundlagen: Baustellen-Schlüssel, Gruppierung Baustelle → Kalenderwoche → Tag,
 * Aufnahmezeitpunkt aus den Bilddaten (EXIF), Verkleinern, Fingerabdruck gegen doppelte Uploads.
 * Alles ohne Zusatzpaket und unabhängig vom späteren Speicherort der Bilder.
 */

/** Gruppierung: Projekt bzw. Name der frei eingegebenen Baustelle (wie bei den Berichten) */
export const photoSiteKey = (p: Pick<Photo, 'projectId' | 'siteName'>) => (p.projectId ? `p:${p.projectId}` : `n:${p.siteName.trim().toLowerCase()}`);

export const SYNC_LABELS: Record<PhotoSync, string> = {
  local: 'nur auf diesem Gerät',
  queued: 'wartet auf Upload',
  uploading: 'wird hochgeladen',
  synced: 'zentral gespeichert',
  failed: 'Upload fehlgeschlagen',
};

/** Längste Kante der gespeicherten Version und des Vorschaubilds (Pixel) */
export const PHOTO_MAX = 2000;
export const THUMB_MAX = 400;

/** Aufnahmetag und Kalenderwoche (Ortszeit) aus einem Zeitpunkt */
export function dayAndWeek(ts: number): { day: string; week: string } {
  const day = isoDate(new Date(ts));
  return { day, week: weekOf(day) };
}

export const weekLabel = (week: string) => `KW ${isoWeekNo(week)}`;
/** „KW 44 · 26.10. – 01.11.2026“ */
export function weekTitle(week: string): string {
  const f = (s: string, y = false) => parseDate(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', ...(y ? { year: 'numeric' } : {}) });
  const end = isoDate(new Date(parseDate(week).getTime() + 6 * 86_400_000));
  return `${weekLabel(week)} · ${f(week)} – ${f(end, true)}`;
}
export const dayTitle = (day: string) => parseDate(day).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
export const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const dateTimeLabel = (ts: number) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export interface SiteGroup {
  key: string;
  projectId: string | null;
  name: string;
  number: string;
  address: string;
  count: number;
  /** erster und letzter Aufnahmetag */
  from: string;
  to: string;
  /** letzte Aktivität (Aufnahme oder Speichern) */
  lastAt: number;
  weeks: { week: string; count: number }[];
  pending: number;
}

/** Baustellen mit Anzahl, Zeitraum und Kalenderwochen (neueste zuerst) */
export function groupBySite(photos: Photo[]): SiteGroup[] {
  const map = new Map<string, SiteGroup & { weekMap: Map<string, number> }>();
  for (const p of photos) {
    const key = photoSiteKey(p);
    let g = map.get(key);
    if (!g) {
      g = { key, projectId: p.projectId, name: p.siteName, number: p.siteNumber, address: p.siteAddress, count: 0, from: p.day, to: p.day, lastAt: 0, weeks: [], pending: 0, weekMap: new Map() };
      map.set(key, g);
    }
    g.count++;
    if (p.day < g.from) g.from = p.day;
    if (p.day > g.to) g.to = p.day;
    g.lastAt = Math.max(g.lastAt, p.uploadedAt, p.takenAt);
    g.weekMap.set(p.week, (g.weekMap.get(p.week) ?? 0) + 1);
    if (p.sync !== 'synced') g.pending++;
    // neueste Bezeichnung/Adresse übernehmen
    if (p.uploadedAt >= g.lastAt) {
      g.name = p.siteName || g.name;
      g.number = p.siteNumber || g.number;
      g.address = p.siteAddress || g.address;
    }
  }
  return [...map.values()].map(({ weekMap, ...g }) => ({ ...g, weeks: [...weekMap].map(([week, count]) => ({ week, count })).sort((a, b) => b.week.localeCompare(a.week)) }));
}

/** Fotos einer Baustelle: Kalenderwoche → Tag → Fotos (neueste Woche zuerst, innerhalb des Tags nach Uhrzeit) */
export function groupByWeekAndDay(photos: Photo[]): { week: string; days: { day: string; photos: Photo[] }[] }[] {
  const weeks = new Map<string, Map<string, Photo[]>>();
  for (const p of photos) {
    if (!weeks.has(p.week)) weeks.set(p.week, new Map());
    const days = weeks.get(p.week)!;
    days.set(p.day, [...(days.get(p.day) ?? []), p]);
  }
  return [...weeks]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, days]) => ({
      week,
      days: [...days].sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => ({ day, photos: list.sort((a, b) => a.takenAt - b.takenAt) })),
    }));
}

/** Suche: Baustelle, Nummer, Adresse, KW („KW 44“, „44“), Datum (JJJJ-MM-TT bzw. TT.MM.), Benutzer, Beschreibung */
export function matchesPhoto(p: Photo, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const kw = /^kw\s*(\d{1,2})$/.exec(t);
  if (kw) return isoWeekNo(p.week) === Number(kw[1]);
  const de = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(t);
  if (de) {
    const [, d, m, y] = de;
    const dd = `${y ? (y.length === 2 ? `20${y}` : y) : p.day.slice(0, 4)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return p.day === dd;
  }
  return [p.siteName, p.siteNumber, p.siteAddress, p.userName, p.description, p.day, p.fileName, `kw ${isoWeekNo(p.week)}`].some((s) => s?.toLowerCase().includes(t));
}

/* ───────────── Bilddaten ───────────── */

/** SHA-256 (hex) – Fingerabdruck der Originaldatei */
export async function fileHash(data: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Aufnahmezeitpunkt aus den EXIF-Daten eines JPEG (DateTimeOriginal „JJJJ:MM:TT HH:MM:SS“, Ortszeit der Kamera).
 * Liefert null, wenn keine Angabe vorhanden ist.
 */
export function exifTakenAt(data: ArrayBuffer): number | null {
  const b = new Uint8Array(data);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF-Kopf
      const le = b[t] === 0x49;
      const dv = new DataView(data, t, Math.min(len - 8, b.length - t));
      const u16 = (o: number) => dv.getUint16(o, le);
      const u32 = (o: number) => dv.getUint32(o, le);
      const text = (off: number, n: number) => {
        let s = '';
        for (let k = 0; k < n - 1 && off + k < dv.byteLength; k++) s += String.fromCharCode(dv.getUint8(off + k));
        return s;
      };
      const parse = (s: string): number | null => {
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
        if (!m) return null;
        const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        return Number.isFinite(ts) && +m[1] > 1990 ? ts : null;
      };
      try {
        const readIfd = (off: number, want: Set<number>, found: Map<number, string>) => {
          const n = u16(off);
          let exifOff = 0;
          for (let k = 0; k < n; k++) {
            const e = off + 2 + k * 12;
            const tag = u16(e);
            const type = u16(e + 2);
            const cnt = u32(e + 4);
            if (tag === 0x8769) exifOff = u32(e + 8);
            if (want.has(tag) && type === 2) found.set(tag, text(cnt > 4 ? u32(e + 8) : e + 8, cnt));
          }
          return exifOff;
        };
        const found = new Map<number, string>();
        const exifOff = readIfd(u32(4), new Set([0x0132]), found);
        if (exifOff) readIfd(exifOff, new Set([0x9003, 0x9004]), found);
        for (const tag of [0x9003, 0x9004, 0x0132]) {
          const v = found.get(tag);
          const ts = v ? parse(v) : null;
          if (ts) return ts;
        }
      } catch {
        return null;
      }
      return null;
    }
    if (marker === 0xda) break; // Bilddaten – kein EXIF mehr
    i += 2 + len;
  }
  return null;
}

export interface PreparedPhoto {
  /** verkleinerte JPEG-Version */
  data: ArrayBuffer;
  thumb: ArrayBuffer;
  width: number;
  height: number;
  hash: string;
  takenAt: number;
  takenFrom: Photo['takenFrom'];
}

/** Bild auf die längste Kante `max` verkleinern (Drehung aus den Bilddaten wird angewendet) */
async function resize(bitmap: ImageBitmap, max: number, quality: number): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden.');
  return { data: await blob.arrayBuffer(), width: w, height: h };
}

/**
 * Foto für die Ablage vorbereiten: Fingerabdruck, Aufnahmezeitpunkt (EXIF → Dateidatum → jetzt),
 * verkleinerte Version und Vorschaubild. Das Original bleibt unverändert (optional mitgespeichert).
 */
export async function preparePhoto(file: File, now = Date.now()): Promise<PreparedPhoto> {
  const buf = await file.arrayBuffer();
  const hash = await fileHash(buf);
  const exif = exifTakenAt(buf);
  // Dateidatum nur, wenn es plausibel vor dem Jetzt liegt (Kamera-Apps setzen es auf die Aufnahme)
  const fileTs = file.lastModified && file.lastModified < now - 2000 && file.lastModified > Date.UTC(2000, 0, 1) ? file.lastModified : null;
  const takenAt = exif ?? fileTs ?? now;
  const takenFrom: Photo['takenFrom'] = exif ? 'exif' : fileTs ? 'file' : 'now';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buf], { type: file.type || 'image/jpeg' }), { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`„${file.name}“ ist kein unterstütztes Bild (JPG, PNG, WEBP, HEIC je nach Gerät).`);
  }
  try {
    const main = await resize(bitmap, PHOTO_MAX, 0.85);
    const thumb = await resize(bitmap, THUMB_MAX, 0.75);
    return { data: main.data, thumb: thumb.data, width: main.width, height: main.height, hash, takenAt, takenFrom };
  } finally {
    bitmap.close?.();
  }
}

export const fmtBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.round(n / 1024)} KB`);
