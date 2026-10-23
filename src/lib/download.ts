import type { ExportFile } from './aufmass';

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function toFile(f: ExportFile): File {
  return new File([f.data as BlobPart], f.name, { type: f.mimeType });
}

/** Lädt eine Datei herunter (Desktop) bzw. speichert sie in „Dateien“ (iOS). */
export function downloadFile(f: ExportFile): void {
  const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFile(f: ExportFile): boolean {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [toFile(f)] });
  } catch {
    return false;
  }
}

export async function shareFile(f: ExportFile): Promise<void> {
  try {
    await navigator.share({ files: [toFile(f)], title: f.name });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw e;
  }
}
