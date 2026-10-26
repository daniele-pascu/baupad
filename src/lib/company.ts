import { getMeta, setMeta } from './db';
import type { HeaderImage } from './xlsx';

/**
 * Firmenlogo für Exporte (Excel-Kopfzeile). Es wird nur auf diesem Gerät gespeichert
 * (IndexedDB, nicht in Projekten oder Sicherungen) und nirgendwohin gesendet.
 */

export interface CompanyLogo {
  /** Bilddaten (PNG oder JPEG) */
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  /** Pixelgröße (für das Seitenverhältnis in der Kopfzeile) */
  width: number;
  height: number;
  name: string;
  /** leere Ränder bereits entfernt (ältere Logos werden beim nächsten Laden zugeschnitten) */
  trimmed?: boolean;
}

const KEY = 'companyLogo';
/** größte gespeicherte Kantenlänge in Pixeln (scharf genug für den Druck, kleine Dateien) */
const MAX_PX = 900;
export const LOGO_MAX_FILE = 8 * 1024 * 1024;

export async function getCompanyLogo(): Promise<CompanyLogo | null> {
  try {
    const v = await getMeta<CompanyLogo>(KEY);
    return v && v.bytes && v.width > 0 && v.height > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function removeCompanyLogo(): Promise<void> {
  await setMeta(KEY, null);
  cached = null;
}

/**
 * Bilddatei (PNG/JPG) als Logo übernehmen: auf höchstens MAX_PX verkleinert; PNG bleibt PNG
 * (Transparenz), JPEG bleibt JPEG.
 */
export async function saveCompanyLogo(file: File): Promise<CompanyLogo> {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (!isPng && !isJpeg) throw new Error('Bitte ein Logo als PNG- oder JPG-Datei auswählen.');
  if (file.size > LOGO_MAX_FILE) throw new Error('Die Datei ist zu groß (höchstens 8 MB).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Das Bild konnte nicht gelesen werden.');
  });
  const type = isPng ? 'png' : 'jpeg';
  const logo = await prepareLogo(bitmap, type, file.name);
  bitmap.close?.();
  await setMeta(KEY, logo);
  cached = { bytes: logo.bytes, type: logo.type, ...logoHeaderSize(logo) };
  return logo;
}

/** Bild verkleinern (höchstens MAX_PX), leere Ränder abschneiden, als PNG/JPEG kodieren */
async function prepareLogo(src: ImageBitmap, type: 'png' | 'jpeg', name: string): Promise<CompanyLogo> {
  const f = Math.min(1, MAX_PX / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * f));
  const h = Math.max(1, Math.round(src.height * f));
  let canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  let ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (type === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0, w, h);
  // leere (weiße bzw. durchsichtige) Ränder entfernen – sonst wirkt das Logo in der Kopfzeile zu klein
  const box = trimBox(ctx.getImageData(0, 0, w, h).data, w, h);
  if (box && (box.w < w || box.h < h)) {
    const cut = document.createElement('canvas');
    cut.width = box.w;
    cut.height = box.h;
    const c2 = cut.getContext('2d')!;
    if (type === 'jpeg') {
      c2.fillStyle = '#fff';
      c2.fillRect(0, 0, box.w, box.h);
    }
    c2.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    canvas = cut;
    ctx = c2;
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, `image/${type}`, 0.92));
  if (!blob) throw new Error('Das Bild konnte nicht umgewandelt werden.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type, width: canvas.width, height: canvas.height, name, trimmed: true };
}

/**
 * Inhalt eines Logos (RGBA): Rahmen um alle Pixel, die weder durchsichtig noch (fast) weiß sind,
 * mit 1 px Abstand. null = kein Inhalt gefunden (dann bleibt das Bild, wie es ist).
 */
export function trimBox(data: ArrayLike<number>, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = data[i + 3] > 16 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);
      if (!ink) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - 1);
  const y = Math.max(0, y0 - 1);
  return { x, y, w: Math.min(w, x1 + 2) - x, h: Math.min(h, y1 + 2) - y };
}

/**
 * Größe in der Kopfzeile (Punkt), passend für jedes Logo: gleiche sichtbare Fläche (ca. 2700 pt²,
 * z. B. 99 × 27 pt bei einem Logo 3,6 : 1), Höhe 16–42 pt, Breite höchstens 170 pt –
 * breite Logos werden flach und breit, quadratische kleiner und höher. Seitenverhältnis bleibt.
 */
export function logoHeaderSize(logo: Pick<CompanyLogo, 'width' | 'height'>): { width: number; height: number } {
  const ratio = logo.width / logo.height;
  let h = Math.min(42, Math.max(16, Math.sqrt(2700 / ratio)));
  let w = h * ratio;
  if (w > 170) {
    w = 170;
    h = w / ratio;
  }
  return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
}

/** Logo für die Excel-Kopfzeile (null = kein Logo hinterlegt); ältere Logos werden einmal zugeschnitten */
export async function excelHeaderLogo(): Promise<HeaderImage | null> {
  let logo = await getCompanyLogo();
  if (logo && !logo.trimmed) {
    try {
      const bmp = await createImageBitmap(new Blob([logo.bytes as BlobPart], { type: `image/${logo.type}` }));
      logo = await prepareLogo(bmp, logo.type, logo.name);
      bmp.close?.();
      await setMeta(KEY, logo);
    } catch {
      /* Logo bleibt unverändert */
    }
  }
  cached = logo ? { bytes: logo.bytes, type: logo.type, ...logoHeaderSize(logo) } : null;
  return cached;
}

/**
 * Vorab geladenes Logo: Exporte bleiben dadurch synchron im Klick (iPhone/iPad erlauben
 * Teilen/Herunterladen nur direkt nach dem Antippen). Laden mit `preloadExcelLogo()`.
 */
let cached: HeaderImage | null | undefined;
export const cachedExcelLogo = () => cached ?? null;
export function preloadExcelLogo(): void {
  void excelHeaderLogo();
}
