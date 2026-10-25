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
  const f = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * f));
  const h = Math.max(1, Math.round(bitmap.height * f));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (!isPng) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const type = isPng ? 'png' : 'jpeg';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, `image/${type}`, 0.92));
  if (!blob) throw new Error('Das Bild konnte nicht umgewandelt werden.');
  const logo: CompanyLogo = { bytes: new Uint8Array(await blob.arrayBuffer()), type, width: w, height: h, name: file.name };
  await setMeta(KEY, logo);
  cached = { bytes: logo.bytes, type: logo.type, ...logoHeaderSize(logo) };
  return logo;
}

/** Größe in der Kopfzeile (Punkt): höchstens 150 × 42 pt, Seitenverhältnis bleibt */
export function logoHeaderSize(logo: Pick<CompanyLogo, 'width' | 'height'>): { width: number; height: number } {
  const f = Math.min(150 / logo.width, 42 / logo.height);
  return { width: Math.round(logo.width * f * 10) / 10, height: Math.round(logo.height * f * 10) / 10 };
}

/** Logo für die Excel-Kopfzeile (null = kein Logo hinterlegt) */
export async function excelHeaderLogo(): Promise<HeaderImage | null> {
  const logo = await getCompanyLogo();
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
