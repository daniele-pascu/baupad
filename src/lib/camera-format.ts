/**
 * Format und Auflösung der Fotos im Kamera-Modus (je Gerät gemerkt). Gilt im Browser (Live-Bild wird beim Auslösen
 * zugeschnitten) und in der Store-App: dort fotografiert die Kamera des Geräts, das Foto wird danach auf das
 * Seitenverhältnis zugeschnitten (Mitte) und auf die gewählte Auflösung verkleinert – nie vergrößert.
 */
export type Ratio = '4:3' | '3:2' | '16:9' | '1:1';
export type Orient = 'auto' | 'portrait' | 'landscape';
export type Quality = 'klein' | 'mittel' | 'hoch';

export const RATIOS: Ratio[] = ['4:3', '3:2', '16:9', '1:1'];
export const ratioValue = (r: Ratio) => {
  const [a, b] = r.split(':').map(Number);
  return a / b;
};

/** längste Kante je Stufe (Pixel) und ungefähre Dateigröße eines Baustellenfotos */
export const QUALITIES: { id: Quality; label: string; max: number; hint: string }[] = [
  { id: 'klein', label: 'Klein', max: 1280, hint: '1280 px · ca. 0,3 MB – schnell hochgeladen, reicht für Berichte' },
  { id: 'mittel', label: 'Mittel', max: 2560, hint: '2560 px · ca. 0,8 MB – scharf auch am großen Bildschirm (Standard)' },
  { id: 'hoch', label: 'Hoch', max: 4096, hint: 'volle Auflösung bis 4096 px · ca. 2–3 MB – für Details, braucht mehr Speicher und Empfang' },
];
export const qualityMax = (q: Quality) => QUALITIES.find((x) => x.id === q)?.max ?? 2560;

/**
 * Ausschnitt eines fertigen Fotos (w × h, schon richtig gedreht) für Seitenverhältnis und Ausrichtung: größtes
 * Rechteck in der Mitte. „Automatisch“ behält die Lage des Fotos, „Hoch“/„Quer“ erzwingen sie.
 */
export function formatCrop(w: number, h: number, ratio: Ratio, orient: Orient): { x: number; y: number; w: number; h: number } {
  const landscape = orient === 'landscape' ? true : orient === 'portrait' ? false : w >= h;
  const r = landscape ? ratioValue(ratio) : 1 / ratioValue(ratio);
  let cw = w;
  let ch = Math.round(w / r);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * r);
  }
  return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* egal */
  }
};
export const loadRatio = () => stored<Ratio>('camRatio', RATIOS, '4:3');
export const loadOrient = () => stored<Orient>('camOrient', ['auto', 'portrait', 'landscape'], 'auto');
export const loadQuality = () => stored<Quality>('camQuality', ['klein', 'mittel', 'hoch'], 'mittel');
export const saveRatio = (r: Ratio) => store('camRatio', r);
export const saveOrient = (o: Orient) => store('camOrient', o);
export const saveQuality = (q: Quality) => store('camQuality', q);

/** Anzeige des Seitenverhältnisses: hochkant gespeicherte Fotos als 3:4, 9:16 … */
export const ratioLabel = (r: Ratio, portrait: boolean) => (portrait && r !== '1:1' ? r.split(':').reverse().join(':') : r);

/**
 * Vorschau füllt den Bildschirm: Das Kamerabild wird so groß gezeigt, dass der Ausschnitt des Fotos (crop, im
 * Kamerabild) möglichst groß und mittig im Bereich box liegt; was vom Kamerabild darüber hinausgeht, füllt den Rest
 * (abgedunkelt). Liefert Lage und Größe des Kamerabilds im Bereich.
 */
export function previewLayout(box: { w: number; h: number }, frame: { w: number; h: number }, crop: { x: number; y: number; w: number; h: number }) {
  const k = Math.min(box.w / crop.w, box.h / crop.h);
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return { k, left: box.w / 2 - cx * k, top: box.h / 2 - cy * k, width: frame.w * k, height: frame.h * k };
}

/**
 * Antippen im Bild → Punkt im Kamerabild (0…1), z. B. für Schärfe und Licht. Berücksichtigt digitalen Zoom (um die
 * Mitte des Bereichs vergrößert) und die gespiegelte Frontkamera.
 */
export function tapToFrame(px: number, py: number, box: { w: number; h: number }, view: { left: number; top: number; width: number; height: number }, digital = 1, mirror = false): { x: number; y: number } {
  const ux = box.w / 2 + (px - box.w / 2) / digital;
  const uy = box.h / 2 + (py - box.h / 2) / digital;
  let x = (ux - view.left) / view.width;
  const y = (uy - view.top) / view.height;
  if (mirror) x = 1 - x;
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return { x: c(x), y: c(y) };
}
