import { fromShapeLocal, type Point } from './geometry';
import type { Shape } from './types';

/**
 * Bauteil- und Symbolbibliothek für „Plan zeichnen“: Türen, Fenster, Elektro (Zeichen nach ÖNORM wie im
 * Skriptum „Elektroinstallationen“). Jedes Symbol ist in einem Einheitsquadrat (u nach rechts, v nach unten,
 * 0…1) beschrieben und wird in das Begrenzungsrechteck des Objekts (Breite × Tiefe in m, Drehung, Spiegelung)
 * gelegt – am Bildschirm und im PDF identisch. Erweiterbar um weitere Gruppen (Sanitär, Heizung, Lüftung …).
 */

export type SymbolGroup = 'door' | 'window' | 'electro' | 'appliance' | 'heating' | 'sanitary' | 'shaft';
export const SYMBOL_GROUPS: { id: SymbolGroup; label: string }[] = [
  { id: 'door', label: 'Türen' },
  { id: 'window', label: 'Fenster' },
  { id: 'electro', label: 'Elektro' },
  { id: 'appliance', label: 'Geräte' },
  { id: 'heating', label: 'Heizung' },
  { id: 'sanitary', label: 'Sanitär' },
  { id: 'shaft', label: 'Fänge, Durchbrüche' },
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
  /** Lage der Wandlinie im Symbol (v 0…1): Türen 1 (unten), Pendeltür/Drehkreuz 0,5, Sanitär 0 (oben) */
  wall?: number;
  /** Bezugspunkt beim Vergrößern in u (Anschlag), Standard 0,5 */
  hinge?: number;
  parts: SymbolPart[];
}

/** Wandlinie eines Symbols (v): nur Türen und Sanitärgegenstände liegen an der Wand */
export const symbolWall = (def: SymbolDef | undefined): number | null =>
  !def ? null : def.wall ?? (def.group === 'door' ? 1 : def.group === 'sanitary' ? 0 : null);

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
/** Schutzkontakt-Steckdose (ÖNORM): nach oben offener Halbkreis, Querstrich, Anschluss zur Wand (unten) */
const dome: SymbolPart[] = [{ pts: arc(0.5, 0.22, 0.34, 0.34, 180, 360) }, line([0.12, 0.5], [0.88, 0.5]), line([0.5, 0.5], [0.5, 1])];
/** Steckdose für nachrichtentechnische Zwecke (⊔) mit Kennbuchstaben (T, TV, FM, LS …) */
const cup = (t: string, size = 0.3): SymbolPart[] => [{ pts: [[0.18, 0.12], [0.18, 0.56], [0.82, 0.56], [0.82, 0.12]] }, line([0.5, 0.56], [0.5, 1]), text(t, 0.5, 0.33, size)];
/** Schalterarm mit Haken (vom Kreisrand zur Spitze, Haken quer nach außen) */
const arm = (a: UV, b: UV, hook: UV): SymbolPart[] => [line(a, b), line(b, hook)];
/** Abgasanschluss über dem Gerät (Strich mit zwei kurzen Stutzen) */
const flue = (u0: number, u1: number, v1: number, v0 = 0.04): SymbolPart[] => [line([u0, v0], [u1, v0]), line([0.42, v0], [0.42, v1]), line([0.58, v0], [0.58, v1])];
/** Kennzeichen Festbrennstoff (Kreuz mit Raute) */
const star = (u: number, v: number, r: number, ry = r): SymbolPart[] => [line([u - r, v], [u + r, v]), line([u, v - ry], [u, v + ry]), { pts: [[u, v - ry * 0.55], [u + r * 0.55, v], [u, v + ry * 0.55], [u - r * 0.55, v]], closed: true }];
const dot = (u: number, v: number, r = 0.035, ry = r): SymbolPart => ({ pts: arc(u, v, r, ry, 0, 360, 12).slice(0, -1), closed: true });
/** Rechteck mit gerundeten Ecken (Radien als Anteile) */
const roundRect = (u0: number, v0: number, u1: number, v1: number, ru: number, rv: number, n = 6): SymbolPart => ({
  pts: [...arc(u1 - ru, v0 + rv, ru, rv, 90, 0, n), ...arc(u1 - ru, v1 - rv, ru, rv, 0, -90, n), ...arc(u0 + ru, v1 - rv, ru, rv, -90, -180, n), ...arc(u0 + ru, v0 + rv, ru, rv, 180, 90, n)],
  closed: true,
});
/** WC-/Becken-Form: oben gerade (Wand), unten rund */
const bowl = (u0: number, u1: number, v0: number, vs: number, v1: number): SymbolPart => ({ pts: [[u0, v0], [u1, v0], ...arc((u0 + u1) / 2, vs, (u1 - u0) / 2, v1 - vs, 0, -180, 16)], closed: true });
/** Abtropffläche einer Spüle (Rillen) */
const ribs = (u0: number, u1: number, v0: number, v1: number, n: number): SymbolPart[] => Array.from({ length: n }, (_, i) => line([u0, v0 + ((v1 - v0) * (i + 0.5)) / n], [u1, v0 + ((v1 - v0) * (i + 0.5)) / n]));
/** Pfeil von a nach b (offene Spitze) */
const arrow = (a: UV, b: UV, head = 0.1): SymbolPart[] => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  return [line(a, b), line(b, [b[0] - head * (ux - uy * 0.6), b[1] - head * (uy + ux * 0.6)]), line(b, [b[0] - head * (ux + uy * 0.6), b[1] - head * (uy - ux * 0.6)])];
};

export const SYMBOLS: SymbolDef[] = [
  // Türen: Anschlag links unten, Flügel offen (90°) – Anschlag/Öffnungsrichtung über Spiegeln umschaltbar
  { id: 'door1', label: 'Tür einflügelig', group: 'door', w: 0.9, h: 0.9, keepAspect: true, flippable: true, hinge: 0, parts: [line([0, 1], [0, 0]), { pts: arc(0, 1, 1, 1, 90, 0) }, line([0, 1], [1, 1], { dashed: true })] },
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
  { id: 'door-swing', label: 'Pendeltür', group: 'door', w: 0.9, h: 1.8, keepAspect: true, flippable: true, wall: 0.5, hinge: 0, parts: [line([0, 0.5], [1, 0.5], { dashed: true }), line([0, 0.5], [0, 0]), { pts: arc(0, 0.5, 1, 0.5, 90, 0) }, line([0, 0.5], [0, 1]), { pts: arc(0, 0.5, 1, 0.5, -90, 0) }] },
  // weitere Öffnungsarten nach ÖNORM A 6240 (Bild 30)
  {
    id: 'door-lift-turn',
    label: 'Hebedrehtür',
    group: 'door',
    w: 0.9,
    h: 0.9,
    keepAspect: true,
    flippable: true,
    hinge: 0,
    parts: [line([0, 1], [0, 0]), { pts: arc(0, 1, 1, 1, 90, 0) }, line([0.09, 0.96], [0.09, 0.62]), { pts: [[0.09, 0.5], [0.15, 0.64], [0.03, 0.64]], closed: true, fill: true }],
  },
  { id: 'door-slide2', label: 'Schiebetür zweiflügelig', group: 'door', w: 1.6, h: 0.2, flippable: true, parts: [rect(0, 0.05, 0.5, 0.4), rect(0.5, 0.05, 1, 0.4), ...arrow([0.4, 0.72], [0.12, 0.72]), ...arrow([0.6, 0.72], [0.88, 0.72])] },
  { id: 'door-lift-slide', label: 'Hebeschiebetür', group: 'door', w: 1.0, h: 0.15, flippable: true, parts: [rect(0, 0.05, 0.62, 0.45), rect(0.38, 0.55, 1, 0.95), line([0.66, 0.45], [0.66, 0.25]), ...arrow([0.66, 0.25], [0.92, 0.25])] },
  { id: 'door-fold-slide', label: 'Faltschiebetür', group: 'door', w: 0.9, h: 0.35, flippable: true, parts: [{ pts: [[0.55, 1], [0.66, 0.15], [0.77, 1], [0.88, 0.15], [1, 1]] }, line([0, 1], [0.55, 1], { dashed: true }), ...arrow([0.48, 0.45], [0.12, 0.45])] },
  { id: 'door-tilt-gate', label: 'Kipptor', group: 'door', w: 2.5, h: 2.5, wall: 0.5, parts: [line([0, 0.5], [1, 0.5]), rect(0.02, 0, 0.98, 1, { dashed: true })] },
  { id: 'door-section-gate', label: 'Sektionaltor', group: 'door', w: 2.5, h: 2.1, parts: [line([0, 1], [1, 1]), { pts: [[0.02, 1], [0.02, 0], [0.98, 0], [0.98, 1]], dashed: true }] },
  {
    id: 'door-revolving',
    label: 'Drehkreuztür (Karusselltür)',
    group: 'door',
    w: 2.0,
    h: 2.0,
    keepAspect: true,
    flippable: true,
    wall: 0.5,
    parts: [circle(0.5, 0.5, 0.42, 32), line([0.2, 0.2], [0.8, 0.8]), line([0.8, 0.2], [0.2, 0.8]), { pts: arc(0.5, 0.5, 0.49, 0.49, 65, 112, 8) }, ...arrow([0.4, 0.04], [0.31, 0.07], 0.07)],
  },
  // Fenster (Grundriss): Rahmen in der Wand, Glas als Doppellinie
  { id: 'win1', label: 'Fenster einflügelig', group: 'window', w: 1.2, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.42], [1, 0.42]), line([0, 0.58], [1, 0.58])] },
  { id: 'win2', label: 'Fenster zweiflügelig', group: 'window', w: 1.6, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.42], [1, 0.42]), line([0, 0.58], [1, 0.58]), line([0.5, 0], [0.5, 1])] },
  { id: 'win-fixed', label: 'Festverglasung', group: 'window', w: 1.2, h: 0.3, parts: [rect(0, 0, 1, 1), line([0, 0.5], [1, 0.5])] },
  { id: 'win-slide', label: 'Schiebefenster', group: 'window', w: 1.6, h: 0.3, flippable: true, parts: [rect(0, 0, 1, 1), line([0, 0.38], [0.6, 0.38]), line([0.4, 0.62], [1, 0.62])] },
  // Elektro (ÖNORM-Sinnbilder)
  { id: 'light-ceiling', label: 'Deckenleuchte', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [line([0.1, 0.1], [0.9, 0.9]), line([0.9, 0.1], [0.1, 0.9])] },
  { id: 'light-wall', label: 'Wandleuchte', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [line([0.1, 1], [0.9, 1]), line([0.5, 0.05], [0.5, 0.78]), line([0.28, 0.56], [0.72, 1]), line([0.72, 0.56], [0.28, 1])] },
  { id: 'outlet-ceiling', label: 'Deckenauslass', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.18), line([0, 0], [1, 1]), line([1, 0], [0, 1])] },
  { id: 'switch', label: 'Schalter (allgemein)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.3, 0.7, 0.14), ...arm([0.4, 0.6], [0.85, 0.15], [0.97, 0.25])] },
  { id: 'switch-series', label: 'Serienschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.5, 0.72, 0.14), ...arm([0.6, 0.62], [0.88, 0.2], [1, 0.28]), ...arm([0.4, 0.62], [0.12, 0.2], [0, 0.28])] },
  { id: 'switch-two-way', label: 'Wechselschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [circle(0.5, 0.5, 0.14), line([0.6, 0.4], [0.95, 0.05]), line([0.95, 0.05], [1, 0.15]), line([0.4, 0.6], [0.05, 0.95]), line([0.05, 0.95], [0, 0.85])] },
  { id: 'switch-cross', label: 'Kreuzschalter', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.14), ...arm([0.6, 0.4], [0.88, 0.06], [1, 0.14]), ...arm([0.4, 0.4], [0.12, 0.06], [0, 0.14]), ...arm([0.4, 0.6], [0.12, 0.94], [0, 0.86]), ...arm([0.6, 0.6], [0.88, 0.94], [1, 0.86])] },
  { id: 'button', label: 'Taster', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.4), circle(0.5, 0.5, 0.16)] },
  { id: 'button-light', label: 'Taster mit Kontrollleuchte', group: 'electro', w: 0.3, h: 0.3, keepAspect: true, parts: [circle(0.5, 0.5, 0.4), circle(0.5, 0.5, 0.22), line([0.39, 0.39], [0.61, 0.61]), line([0.61, 0.39], [0.39, 0.61])] },
  { id: 'socket', label: 'Schutzkontakt-Steckdose', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: dome },
  { id: 'socket-3', label: 'Mehrfach-Steckdose (3-fach)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: [...dome, text('3', 0.92, 0.1, 0.26)] },
  { id: 'socket-tv', label: 'Antennensteckdose (TV)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: cup('TV', 0.26) },
  { id: 'socket-data', label: 'Netzwerkanschluss (EDV)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: cup('EDV', 0.2) },
  { id: 'socket-phone', label: 'Telefonanschluss', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: cup('T') },
  { id: 'socket-fm', label: 'UKW-Rundfunk (FM)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: cup('FM', 0.26) },
  { id: 'distribution', label: 'Verteiler', group: 'electro', w: 0.6, h: 0.3, parts: [rect(0, 0, 1, 1), { pts: [[0, 1], [1, 0], [1, 1]], closed: true, fill: true }] },
  { id: 'fuse-box', label: 'Sicherungskasten', group: 'electro', w: 0.6, h: 0.4, parts: [rect(0, 0, 1, 1), rect(0.15, 0.3, 0.35, 0.7), rect(0.4, 0.3, 0.6, 0.7), rect(0.65, 0.3, 0.85, 0.7)] },
  { id: 'motion', label: 'Bewegungsmelder', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.42), text('BM', 0.5, 0.52, 0.32)] },
  { id: 'smoke', label: 'Rauchmelder', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, parts: [circle(0.5, 0.5, 0.42), text('RM', 0.5, 0.52, 0.32)] },
  { id: 'speaker', label: 'Lautsprecher (LS)', group: 'electro', w: 0.4, h: 0.4, keepAspect: true, flippable: true, parts: cup('LS', 0.26) },
  // Elektrogeräte (Quadrat mit Kurzzeichen)
  { id: 'stove', label: 'Herd', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), circle(0.3, 0.3, 0.13), circle(0.7, 0.3, 0.13), circle(0.3, 0.7, 0.13), circle(0.7, 0.7, 0.13)] },
  { id: 'dishwasher', label: 'Geschirrspülmaschine', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('GS')] },
  { id: 'washer', label: 'Waschmaschine', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('WM')] },
  { id: 'dryer', label: 'Wäschetrockner', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('WT')] },
  { id: 'fridge', label: 'Kühlschrank', group: 'appliance', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), text('KS')] },
  { id: 'microwave', label: 'Mikrowelle', group: 'appliance', w: 0.5, h: 0.4, parts: [rect(0, 0, 1, 1), text('MK')] },
  // Heizung
  // Heizgeräte nach ÖNORM A 6240 (Kap. 16): Strich mit Stutzen = Abgasanschluss; Buchstabe = Energie (G Gas, Ö Öl, K Koks/Kohle, E Strom)
  { id: 'radiator', label: 'Heizkörper', group: 'heating', w: 1.0, h: 0.1, parts: [rect(0, 0, 1, 1)] },
  { id: 'storage-heater', label: 'Elektrospeicher', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [circle(0.5, 0.5, 0.45, 32), text('E', 0.5, 0.52, 0.4)] },
  { id: 'heat-stove', label: 'Herd (EH Elektro, KH Kohle)', group: 'heating', w: 0.6, h: 0.6, keepAspect: true, parts: [rect(0, 0, 1, 1), circle(0.5, 0.5, 0.47, 32), text('EH', 0.5, 0.52, 0.32)] },
  { id: 'gas-boiler', label: 'Gasgerät (Therme)', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [...flue(0.05, 0.95, 0.3), rect(0.1, 0.3, 0.9, 1), text('G', 0.5, 0.66, 0.4)] },
  { id: 'boiler-gas', label: 'Heizkessel Gas', group: 'heating', w: 0.6, h: 0.8, keepAspect: true, parts: [...flue(0.05, 0.95, 0.16), rect(0.12, 0.16, 0.88, 1), text('G', 0.5, 0.6, 0.4)] },
  { id: 'boiler-oil', label: 'Heizkessel Öl', group: 'heating', w: 0.6, h: 0.8, keepAspect: true, parts: [...flue(0.05, 0.95, 0.16), rect(0.12, 0.16, 0.88, 1), text('Ö', 0.5, 0.6, 0.4)] },
  { id: 'tiled-stove', label: 'Kachelofen', group: 'heating', w: 1.0, h: 0.6, parts: [...flue(0.3, 0.7, 0.16), rect(0, 0.16, 1, 1), rect(0.05, 0.26, 0.95, 0.9), ...star(0.5, 0.58, 0.06, 0.1)] },
  { id: 'iron-stove', label: 'Eiserner Ofen', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [...flue(0.15, 0.85, 0.235), circle(0.5, 0.6, 0.38, 32), ...star(0.5, 0.6, 0.12)] },
  { id: 'stove-oil', label: 'Ofen Öl (Ö)', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [...flue(0.15, 0.85, 0.235), circle(0.5, 0.6, 0.38, 32), text('Ö', 0.5, 0.62, 0.36)] },
  { id: 'stove-gas', label: 'Ofen Gas (G)', group: 'heating', w: 0.5, h: 0.5, keepAspect: true, parts: [...flue(0.15, 0.85, 0.235), circle(0.5, 0.6, 0.38, 32), text('G', 0.5, 0.62, 0.36)] },

  // Sanitärgegenstände nach ÖNORM A 6240 (Kap. 15) – Wandseite oben
  { id: 'wc-wall', label: 'WC (Spülkasten in der Wand)', group: 'sanitary', w: 0.38, h: 0.55, keepAspect: true, flippable: true, parts: [bowl(0, 1, 0, 0.5, 1), bowl(0.16, 0.84, 0.16, 0.5, 0.86)] },
  { id: 'wc-tank', label: 'WC mit Spülkasten', group: 'sanitary', w: 0.4, h: 0.75, keepAspect: true, flippable: true, parts: [rect(0, 0, 1, 0.26), bowl(0, 1, 0.3, 0.64, 1), bowl(0.16, 0.84, 0.42, 0.64, 0.9)] },
  { id: 'urinal', label: 'Urinal', group: 'sanitary', w: 0.36, h: 0.32, keepAspect: true, flippable: true, parts: [bowl(0, 1, 0, 0.3, 1), bowl(0.18, 0.82, 0.18, 0.3, 0.8)] },
  { id: 'basin', label: 'Waschbecken', group: 'sanitary', w: 0.6, h: 0.45, keepAspect: true, flippable: true, parts: [bowl(0, 1, 0, 0.4, 1), bowl(0.08, 0.92, 0.14, 0.4, 0.88), dot(0.5, 0.52, 0.04, 0.05)] },
  {
    id: 'basin-double',
    label: 'Doppelwaschbecken',
    group: 'sanitary',
    w: 1.3,
    h: 0.5,
    keepAspect: true,
    flippable: true,
    parts: [{ pts: [[0, 0], [1, 0], ...arc(0.86, 0.6, 0.14, 0.4, 0, -90, 6), ...arc(0.14, 0.6, 0.14, 0.4, -90, -180, 6)], closed: true }, { pts: arc(0.27, 0.52, 0.22, 0.34, 0, 360, 24).slice(0, -1), closed: true }, { pts: arc(0.73, 0.52, 0.22, 0.34, 0, 360, 24).slice(0, -1), closed: true }, dot(0.27, 0.5, 0.018, 0.05), dot(0.73, 0.5, 0.018, 0.05)],
  },
  { id: 'bidet', label: 'Sitzwaschbecken (Bidet)', group: 'sanitary', w: 0.38, h: 0.55, keepAspect: true, flippable: true, parts: [bowl(0, 1, 0, 0.5, 1), bowl(0.16, 0.84, 0.16, 0.5, 0.86), dot(0.5, 0.4, 0.05, 0.035)] },
  { id: 'bathtub', label: 'Badewanne', group: 'sanitary', w: 1.7, h: 0.75, keepAspect: true, flippable: true, parts: [rect(0, 0, 1, 1), roundRect(0.03, 0.08, 0.97, 0.92, 0.1, 0.22), dot(0.08, 0.5, 0.01, 0.025)] },
  { id: 'shower', label: 'Brausetasse', group: 'sanitary', w: 0.9, h: 0.9, keepAspect: true, flippable: true, parts: [rect(0, 0, 1, 1), roundRect(0.06, 0.06, 0.94, 0.94, 0.06, 0.06), line([0.14, 0.16], [0.8, 0.16]), line([0.86, 0.22], [0.86, 0.86]), line([0.14, 0.86], [0.8, 0.22]), dot(0.86, 0.16, 0.03)] },
  {
    id: 'sitz-bath',
    label: 'Sitzbadewanne',
    group: 'sanitary',
    w: 1.2,
    h: 0.75,
    keepAspect: true,
    flippable: true,
    parts: [rect(0, 0, 1, 1), roundRect(0.03, 0.08, 0.97, 0.92, 0.18, 0.4), line([0.6, 0.08], [0.6, 0.92]), dot(0.1, 0.5, 0.015, 0.025)],
  },
  { id: 'sink1', label: 'Einbeckenspüle mit Abtropffläche', group: 'sanitary', w: 0.9, h: 0.6, keepAspect: true, flippable: true, parts: [rect(0, 0, 1, 1), line([0.6, 0], [0.6, 1]), ...ribs(0.05, 0.55, 0.1, 0.9, 7), roundRect(0.65, 0.12, 0.95, 0.88, 0.06, 0.1), dot(0.71, 0.22, 0.02, 0.03)] },
  {
    id: 'sink2',
    label: 'Zweibeckenspüle mit Abtropffläche',
    group: 'sanitary',
    w: 1.2,
    h: 0.6,
    keepAspect: true,
    flippable: true,
    parts: [rect(0, 0, 1, 1), line([0.36, 0], [0.36, 1]), ...ribs(0.04, 0.32, 0.1, 0.9, 7), roundRect(0.4, 0.12, 0.66, 0.88, 0.05, 0.1), roundRect(0.7, 0.12, 0.96, 0.88, 0.05, 0.1), dot(0.6, 0.22, 0.015, 0.03), dot(0.75, 0.22, 0.015, 0.03)],
  },
  { id: 'slop-sink', label: 'Ausgussbecken', group: 'sanitary', w: 0.45, h: 0.45, keepAspect: true, parts: [rect(0, 0, 1, 1), dot(0.5, 0.5, 0.05)] },

  // Fänge (Kap. 13) und Durchbrüche/Aussparungen (Kap. 14)
  { id: 'chimney', label: 'Rauchfang', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [rect(0, 0, 1, 1), { pts: [[0, 0], [1, 0], [0, 1]], closed: true, fill: true }] },
  { id: 'chimney-round', label: 'Rauchfang rund', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [circle(0.5, 0.5, 0.5, 32), { pts: [...arc(0.5, 0.5, 0.5, 0.5, 45, 225, 16)], closed: true, fill: true }] },
  { id: 'flue-gas', label: 'Abgasfang', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [rect(0, 0, 1, 1), line([0, 0], [1, 1]), line([1, 0], [0, 1])] },
  { id: 'flue-gas-round', label: 'Abgasfang rund', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [circle(0.5, 0.5, 0.5, 32), line([0.15, 0.15], [0.85, 0.85]), line([0.85, 0.15], [0.15, 0.85])] },
  { id: 'air-shaft', label: 'Luftfang', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [rect(0, 0, 1, 1), line([0, 1], [1, 0])] },
  { id: 'air-shaft-round', label: 'Luftfang rund', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [circle(0.5, 0.5, 0.5, 32), line([0.15, 0.85], [0.85, 0.15])] },
  { id: 'floor-opening', label: 'Fußbodendurchbruch (FBD)', group: 'shaft', w: 0.7, h: 0.5, parts: [rect(0, 0, 1, 1), { pts: [[0, 0], [1, 0], [0.18, 0.22], [0, 1]], closed: true, fill: true }] },
  { id: 'ceiling-opening', label: 'Deckendurchbruch (DD, darüber)', group: 'shaft', w: 0.7, h: 0.5, parts: [rect(0, 0, 1, 1, { dashed: true }), { pts: [[0, 1], [0.18, 0.22], [1, 0]], dashed: true }] },
  { id: 'floor-recess', label: 'Fußbodenaussparung (FBA)', group: 'shaft', w: 0.7, h: 0.5, parts: [rect(0, 0, 1, 1), { pts: [[0, 1], [0.18, 0.22], [1, 0]] }] },
  { id: 'opening-small', label: 'Kleiner Durchbruch', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [rect(0, 0, 1, 1), line([0, 0], [1, 1]), line([1, 0], [0, 1])] },
  { id: 'recess-small', label: 'Kleine Aussparung', group: 'shaft', w: 0.2, h: 0.2, keepAspect: true, parts: [rect(0, 0, 1, 1), line([0, 1], [1, 0])] },
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
  const base: [number, number] = [def.hinge ?? 0.5, symbolWall(def) ?? 0.5];
  const x = ref.flipX ? 1 - base[0] : base[0];
  const y = ref.flipY ? 1 - base[1] : base[1];
  return { x, y, lockY: symbolWall(def) !== null };
}
