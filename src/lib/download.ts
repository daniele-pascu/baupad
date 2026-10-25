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

// ---------------------------------------------------------------------------
// „Speichern unter …“ mit Ordnerwahl (Chrome/Edge am PC; Safari/Firefox/iOS: nicht verfügbar)

type SaveHandle = { createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
type SavePicker = (o: {
  suggestedName: string;
  startIn?: unknown;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

export const canSaveAs = () => typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function';

/**
 * Datei über „Speichern unter …“ ablegen: Ordner und Namen wählt man selbst; der zuletzt
 * gewählte Ordner wird gemerkt (nur auf diesem Gerät). 'cancel' = abgebrochen.
 */
export async function saveFileAs(f: ExportFile, lastHandle?: unknown): Promise<{ result: 'saved' | 'cancel'; handle?: unknown }> {
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
  const ext = f.name.split('.').pop() ?? '';
  const pick = (startIn?: unknown) =>
    picker({ suggestedName: f.name, ...(startIn ? { startIn } : {}), types: [{ description: ext.toUpperCase() || 'Datei', accept: { [f.mimeType]: ext ? [`.${ext}`] : [] } }] });
  let handle: SaveHandle;
  try {
    handle = await pick(lastHandle).catch((e) => {
      // gemerkter Ordner nicht mehr verfügbar → ohne Vorgabe erneut
      if ((e as Error).name !== 'AbortError' && lastHandle) return pick();
      throw e;
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { result: 'cancel' };
    throw e;
  }
  const w = await handle.createWritable();
  await w.write(new Blob([f.data as BlobPart], { type: f.mimeType }));
  await w.close();
  return { result: 'saved', handle };
}
