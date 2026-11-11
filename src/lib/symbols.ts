import { fromShapeLocal, type Point } from './geometry';
import type { Shape } from './types';

/**
 * Bauteil- und Symbolbibliothek für „Plan zeichnen“: Türen, Fenster, Elektro (Zeichen nach ÖNORM wie im
 * Skriptum „Elektroinstallationen“). Jedes Symbol ist in einem Einheitsquadrat (u nach rechts, v nach unten,
 * 0…1) beschrieben und wird in das Begrenzungsrechteck des Objekts (Breite × Tiefe in m, Drehung, Spiegelung)
 * gelegt – am Bildschirm und im PDF identisch. Erweiterbar um weitere Gruppen (Sanitär, Heizung, Lüftung …).
 */

export type SymbolGroup = 'door' | 'window' | 'electro' | 'appliance' | 'heating';
export const SYMBOL_GROUPS: { id: SymbolGroup; label: string }[] = [
  { id: 'door', label: 'Türen' },
  { id: 'window', label: 'Fenster' },
  { id: 'electro', label: 'Elektro' },
  { id: 'appliance', label: 'Geräte' },
  { id: 'heating', label: 'Heizung' },
];

type UV = [number, number];
export interface SymbolPart {
  pts?: UV[];
  closed?: boolean;
  dashed?: boolean;
  fill?: boolean;
  /** Text (Mitte bei u/v, Höhe als Anteil der kleineren Seite) */
  text?: string;
  at?: UV;
  size?: number;
}
export interface SymbolDef {
  id: string;
  label: string;
  group: SymbolGroup;
  /** Standardgröße in m (Breite × Tiefe) */
  w: number;
  h: number;
  /** Seitenverhältnis beibehalten, wenn nur die Breite eingegeben wird */
  keepAspect?: boolean;
  /** Anschlag/Öffnungsrichtung umschaltbar (Türen, Fenster) */
  flippable?: boolean;
  parts: SymbolPart[];
}

/* Hilfen im Einheitsquadrat */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18): UV[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy - ry * Math.sin(a)] as UV;
  });
const circle = (cx: number, cy: number, r: number, n = 24): SymbolPart => ({ pts: arc(cx, cy, r, r, 0, 360, n).slice(0, -1), closed: true });
const rect = (u0: number, v0: number, u1: number, v1: number, extra: Partial<SymbolPart> = {}): SymbolPart => ({ pts: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], closed: true, ...extra });
const line = (a: UV, b: UV, extra: Partial<SymbolPart> = {}): SymbolPart => ({ pts: [a, b], ...extra });
const text = (t: string, u = 0.5, v = 0.52, size = 0.42): SymbolPart => ({ text: t, at: [u, v], size });
const dome: SymbolPart[] = [{ pts: arc(0.5, 0.78, 0.32, 0.32, 0, 180) }, line([0.18, 0.78], [0.82, 0.78]), line([0.5, 0.78], [0.5, 1])];

export const SYMBOLS: SymbolDef[] = [
  // Türen: Anschlag links unten, Flügel offen (90°) – Anschlag/Öffnungsrichtung über Spiegeln umschaltbar
  { id: 'door1', label: 'Tür einflügelig', group: 'door', w: 0.9, h: 0.9, keepAspect: true, flippable: true, parts: [line([0, 1], [0, 0]), { pts: arc(0, 1, 1, 1, 90, 0) }, line([0, 1], [1, 1], { dashed: true })] },
  {
    id: 'door2',
    label: 'Tür zweiflügelig',
    group: 'door',
    w: 1.6,
    h: 0.8,
    keepAspect: true,
    flippable: true,
    parts: [line([0, 1], [0, 0]), { pts: arc(0, 1, 0.5, 1, 90, 0) }, line([1, 1], [1, 0]), { pts: arc(1, 1, 0.5, 1, 90, 180) }, line([0, 1], [1, 1], { dashed: true })],
  },
  { id: 'door-slide', label: 'Schiebetür', group: 'door', w: 1.0, h: 0.15, flippable: true, parts: [rect(0, 0.05, 0.62, 0.45), rect(0.38, 0.55, 1, 0.95), line([0.66, 0.25], [0.9, 0.25]), line([0.9, 0.25], [0.84, 0.12]), line([0.9, 0.25], [0.84, 0.38])] },
  { id: 'door-fold', label: 'Falttür', group: 'door', w: 0.9, h: 0.3, flippable: true, parts: [{ pts: [[0, 1], [0.25, 0.1], [0.5, 1], [0.75, 0.1], [1, 1]] }, line([0, 1], [1, 1], { dashed: true })] },
  { id: 'door-swing', label: 'Pendeltür', group: 'door', w: 0.9, h: 1.8, keepAspect: true, flippable: true, parts: [line([0, 0.5], [1, 0.5], { dashed: true }), line([0, 0.5], [0, 0]), { pts: arc(0, 0.5, 1, 0.5, 90, 0) }, line([0, 0.5], [0, 1]), { pts: arc(0, 0.5, 1, 0.5, -90, 0) }] },
  // Fenster (Grundriss): Rahmen in der Wand, Glas als Doppellinie
  { id: 'win1', label: 'Fenster einflügelig', group: 'window', w: 1.2, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.42], [1, 0.42]), line([0, 0.58], [1, 0.58])] },
  { id: 'win2', label: 'Fenster zweiflügelig', group: 'window', w: 1.6, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.42], [1, 0.42]), line([0, 0.58], [1, 0.58]), line([0.5, 0], [0.5, 1])] },
  { id: 'win-fixed', label: 'Festverglasung', group: 'window', w: 1.2, h: 0.3, parts: [rect(0, 0, 1, 1), line([0, 0.5], [1, 0.5])] },
  { id: 'win-slide', label: 'Schiebefenster', group: 'window', w: 1.6, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.38], [0.6, 0.38]), line([0.4, 0.62], [1, 0.62])] },
  // Elektro (ÖNORM-Sinnbilder)
  { id: 'light-ceiling', label: 'Deckenleuchte', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.42), line([0.2, 0.2], [0.8, 0.8]), line([0.8, 0.2], [0.2, 0.8])] },
  { id: 'light-wall', label: 'Wandleuchte', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [line([0.1, 1], [0.9, 1]), line([0.5, 1], [0.5, 0.6]), line([0.28, 0.38], [0.72, 0.82]), line([0.72, 0.38], [0.28, 0.82])] },
  { id: 'outlet-ceiling', label: 'Deckenauslass', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.18), line([0, 0], [1, 1]), line([1, 0], [0, 1])] },
  { id: 'switch', label: 'Schalter (allgemein)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.3, 0.7, 0.14), line([0.4, 0.6], [0.9, 0.1])] },
  { id: 'switch-series', label: 'Serienschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.3, 0.7, 0.14), line([0.4, 0.6], [0.9, 0.1]), line([0.9, 0.1], [1, 0.2]), line([0.75, 0.25], [0.85, 0.35])] },
  { id: 'switch-two-way', label: 'Wechselschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.5, 0.5, 0.14), line([0.6, 0.4], [0.95, 0.05]), line([0.95, 0.05], [1, 0.15]), line([0.4, 0.6], [0.05, 0.95]), line([0.05, 0.95], [0, 0.85])] },
  { id: 'switch-cross', label: 'Kreuzschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.14), line([0.6, 0.4], [0.95, 0.05]), line([0.4, 0.6], [0.05, 0.95]), line([0.4, 0.4], [0.05, 0.05]), line([0.6, 0.6], [0.95, 0.95])] },
  { id: 'button', label: 'Taster', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.4), circle(0.5, 0.5, 0.16)] },
  { id: 'button-light', label: 'Taster mit Kontrollleuchte', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.4), { ...circle(0.5, 0.5, 0.16), fill: true }] },
  { id: 'socket', label: 'Schutzkontakt-Steckdose', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, line([0.18, 0.3], [0.82, 0.3])] },
  { id: 'socket-3', label: 'Mehrfach-Steckdose (3-fach)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, line([0.18, 0.3], [0.82, 0.3]), text('3', 0.88, 0.15, 0.3)] },
  { id: 'socket-tv', label: 'Antennensteckdose (TV)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, text('TV', 0.5, 0.25, 0.32)] },
  { id: 'socket-data', label: 'Netzwerkanschluss (EDV)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, text('EDV', 0.5, 0.25, 0.26)] },
  { id: 'socket-phone', label: 'Telefonanschluss', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, text('T', 0.5, 0.25, 0.32)] },
  { id: 'distribution', label: 'Verteiler', group: 'electro', w: 0.6, h: 0.3, parts: [rect(0, 0, 1, 1), { pts: [[0, 1], [1, 0], [1, 1]], closed: true, fill: true }] },
  { id: 'fuse-box', label: 'Sicherungskasten', group: 'electro', w: 0.6, h: 0.4, parts: [rect(0, 0, 1, 1), rect(0.15, 0.3, 0.35, 0.7), rect(0.4, 0.3, 0.6, 0.7), rect(0.65, 0.3, 0.85, 0.7)] },
  { id: 'motion', label: 'Bewegungsmelder', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.42), text('BM', 0.5, 0.52, 0.32)] },
  { id: 'smoke', label: 'Rauchmelder', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.42), text('RM', 0.5, 0.52, 0.32)] },
  { id: 'speaker', label: 'Lautsprecher', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [rect(0.15, 0.35, 0.4, 0.65), { pts: [[0.4, 0.35], [0.8, 0.1], [0.8, 0.9], [0.4, 0.65]], closed: true }] },
  // Elektrogeräte (Quadrat mit Kurzzeichen)
  { id: 'stove', label: 'Herd', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), circle(0.3, 0.3, 0.13), circle(0.7, 0.3, 0.13), circle(0.3, 0.7, 0.13), circle(0.7, 0.7, 0.13)] },
  { id: 'dishwasher', label: 'Geschirrspülmaschine', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('GS')] },
  { id: 'washer', label: 'Waschmaschine', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('WM')] },
  { id: 'dryer', label: 'Wäschetrockner', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('WT')] },
  { id: 'fridge', label: 'Kühlschrank', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('KS')] },
  { id: 'microwave', label: 'Mikrowelle', group: 'appliance', w: 0.5, h: 0.4, parts: [rect(0, 0, 1, 1), text('MW')] },
  // Heizung
  { id: 'radiator', label: 'Heizkörper', group: 'heating', w: 1.0, h: 0.15, parts: [rect(0, 0, 1, 1), ...[0.2, 0.4, 0.6, 0.8].map((u) => line([u, 0], [u, 1]))] },
  { id: 'storage-heater', label: 'Elektrospeicher', group: 'heating', w: 0.8, h: 0.3, parts: [rect(0, 0, 1, 1), text('E', 0.5, 0.55, 0.7)] },
  { id: 'gas-boiler', label: 'Gastherme', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [rect(0, 0, 1, 1), text('G', 0.5, 0.55, 0.6)] },
  { id: 'tiled-stove', label: 'Kachelofen', group: 'heating', w: 1.0, h: 0.8, parts: [rect(0, 0, 1, 1), rect(0.1, 0.1, 0.9, 0.9)] },
];

export const symbolDef = (id: string | undefined) => SYMBOLS.find((s) => s.id === id);

export interface SymbolRef {
  id: string;
  /** Anschlag wechseln (links/rechts) */
  flipX?: boolean;
  /** Öffnungsrichtung wechseln (innen/außen) */
  flipY?: boolean;
}

/** Geometrie eines Symbols in den Koordinaten der Form (Begrenzungsrechteck, Drehung, Spiegelung) */
export function symbolGeometry(ref: SymbolRef, s: Shape): { lines: { pts: Point[]; closed: boolean; dashed: boolean; fill: boolean }[]; texts: { at: Point; size: number; text: string; angle: number }[] } {
  const def = symbolDef(ref.id);
  const lines: { pts: Point[]; closed: boolean; dashed: boolean; fill: boolean }[] = [];
  const texts: { at: Point; size: number; text: string; angle: number }[] = [];
  if (!def) return { lines: [{ pts: [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }].map((p) => fromShapeLocal(s, p)), closed: true, dashed: true, fill: false }], texts };
  const map = ([u, v]: UV): Point => fromShapeLocal(s, { x: s.x + (ref.flipX ? 1 - u : u) * s.w, y: s.y + (ref.flipY ? 1 - v : v) * s.h });
  for (const p of def.parts) {
    if (p.pts) lines.push({ pts: p.pts.map(map), closed: !!p.closed, dashed: !!p.dashed, fill: !!p.fill });
    if (p.text && p.at) texts.push({ at: map(p.at), size: (p.size ?? 0.4) * Math.min(s.w, s.h), text: p.text, angle: s.rotation ?? 0 });
  }
  return { lines, texts };
}

/**
 * Bezugspunkt beim gleichmäßigen Vergrößern/Verkleinern (Anteile 0…1 der Begrenzung) – nur für Symbole mit festem
 * Seitenverhältnis. Türen: Öffnungslinie (Wandseite) bleibt immer auf der Wand, Anschlag bleibt stehen; so passt der
 * Flügelaufschlag immer zur Türbreite. lockY: senkrecht immer an diesem Punkt, egal welcher Anfasser gezogen wird.
 */
export function symbolAnchor(ref: { id: string; flipX?: boolean; flipY?: boolean } | undefined): { x: number; y: number; lockY: boolean } | null {
  const def = symbolDef(ref?.id);
  if (!def?.keepAspect || !ref) return null;
  const base: [number, number] = def.id === 'door1' ? [0, 1] : def.id === 'door2' ? [0.5, 1] : def.id === 'door-swing' ? [0, 0.5] : [0.5, 0.5];
  const x = ref.flipX ? 1 - base[0] : base[0];
  const y = ref.flipY ? 1 - base[1] : base[1];
  return { x, y, lockY: def.group === 'door' };
}
