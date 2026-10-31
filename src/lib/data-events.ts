import { useEffect } from 'react';

/**
 * Daten haben sich im Hintergrund geändert (Abgleich mit der zentralen Ablage hat Projekte, Berichte,
 * Wochen, Mängelpläne … anderer Geräte übernommen) – Seiten laden ihre Listen neu.
 */
const EVT = 'baupad:data';
export const notifyDataChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
};
export function onDataChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
/** Seite: beim Abgleich neu laden (cb wird nicht als Abhängigkeit geführt – immer die aktuelle Fassung) */
export function useDataChanged(cb: () => void) {
  useEffect(() => onDataChanged(cb));
}
