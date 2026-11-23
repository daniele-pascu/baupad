import type { HatchPattern } from './types';

/**
 * Schraffuren nach DIN ISO 128-50 (Darstellung von Stoffen in Schnitten): Grundschraffur, feste Stoffe (Naturstoffe,
 * Metalle, Kunststoffe), flüssige und gasförmige Stoffe – in Schwarz-Weiß. Jede Schraffur ist aus wenigen Bausteinen
 * aufgebaut (Linien mit Strichmuster, Zeichen je Rasterzelle, Wellen, Bänder); der Winkel dreht das ganze Muster,
 * der Abstand `s` skaliert es.
 */
export interface DinHatch {
  /** Kurzzeichen der Norm, z. B. „SN46“ */
  code: string;
  label: string;
  group: DinGroup;
  /** reines Linienmuster: wird in schmalen Flächen dichter (mindestens einige Linien über die Breite) */
  lines?: boolean;
}
export type DinGroup = 'basis' | 'metall' | 'kunststoff' | 'fluessig' | 'boden' | 'holz' | 'mauerwerk' | 'sonstige';

export const DIN_GROUPS: { id: DinGroup; label: string }[] = [
  { id: 'basis', label: 'Grundschraffuren' },
  { id: 'mauerwerk', label: 'Mauerwerk, Beton, Gips' },
  { id: 'holz', label: 'Holz, Bitumen, Teer' },
  { id: 'boden', label: 'Boden, Gestein' },
  { id: 'metall', label: 'Metalle' },
  { id: 'kunststoff', label: 'Kunststoffe' },
  { id: 'fluessig', label: 'Flüssige Stoffe' },
  { id: 'sonstige', label: 'Glas, Keramik, Dämm- und Dichtstoffe' },
];

export const DIN_HATCHES: DinHatch[] = [
  { code: 'U', label: 'Grundschraffur', group: 'basis', lines: true },
  { code: 'S', label: 'Feste Stoffe', group: 'basis', lines: true },
  { code: 'SN', label: 'Naturstoffe', group: 'basis', lines: true },
  { code: 'SM', label: 'Metalle', group: 'basis', lines: true },
  { code: 'SP', label: 'Kunststoffe', group: 'basis', lines: true },
  { code: 'L', label: 'Flüssige Stoffe', group: 'basis' },
  { code: 'G', label: 'Gasförmige Stoffe', group: 'basis' },

  { code: 'SN41', label: 'Mauerwerk, Ziegel', group: 'mauerwerk', lines: true },
  { code: 'SN42', label: 'Mauerwerk mit erhöhter Festigkeit', group: 'mauerwerk', lines: true },
  { code: 'SN43', label: 'Mauerwerk, Leichtziegel', group: 'mauerwerk' },
  { code: 'SN44', label: 'Mauerwerk, Bimsbaustoffe', group: 'mauerwerk' },
  { code: 'SN45', label: 'Gipsplatte', group: 'mauerwerk' },
  { code: 'SN46', label: 'Beton, bewehrt', group: 'mauerwerk', lines: true },
  { code: 'SN47', label: 'Beton, unbewehrt', group: 'mauerwerk', lines: true },
  { code: 'SN48', label: 'Leichtbeton', group: 'mauerwerk' },
  { code: 'SN49', label: 'Bimsbeton', group: 'mauerwerk', lines: true },
  { code: 'SN50', label: 'Beton, wasserundurchlässig', group: 'mauerwerk', lines: true },

  { code: 'SN21', label: 'Vollholz, quer zur Faser', group: 'holz', lines: true },
  { code: 'SN22', label: 'Vollholz in Faserrichtung', group: 'holz', lines: true },
  { code: 'SN23', label: 'Holzwerkstoff', group: 'holz', lines: true },
  { code: 'SN24', label: 'Bitumen', group: 'holz' },
  { code: 'SN25', label: 'Teer', group: 'holz' },

  { code: 'SN1', label: 'Gewachsener Boden', group: 'boden' },
  { code: 'SN2', label: 'Geschütteter Boden', group: 'boden' },
  { code: 'SN3', label: 'Fels', group: 'boden' },
  { code: 'SN4', label: 'Kies', group: 'boden' },
  { code: 'SN5', label: 'Sand', group: 'boden' },
  { code: 'SN6', label: 'Schluff', group: 'boden' },
  { code: 'SN7', label: 'Ton', group: 'boden' },
  { code: 'SN8', label: 'Torf, Humus', group: 'boden' },
  { code: 'SN9', label: 'Mudde', group: 'boden' },
  { code: 'SN10', label: 'Kohle', group: 'boden' },
  { code: 'SN11', label: 'Salze', group: 'boden' },
  { code: 'SN12', label: 'Sandstein', group: 'boden' },

  { code: 'SM1', label: 'Stahl, legiert', group: 'metall', lines: true },
  { code: 'SM2', label: 'Stahl, unlegiert', group: 'metall', lines: true },
  { code: 'SM3', label: 'Gusseisen', group: 'metall', lines: true },
  { code: 'SM11', label: 'Leichtmetalle', group: 'metall', lines: true },
  { code: 'SM12', label: 'Schwermetalle', group: 'metall', lines: true },

  { code: 'SP1', label: 'Elastomere, Gummi', group: 'kunststoff', lines: true },
  { code: 'SP2', label: 'Duroplaste', group: 'kunststoff', lines: true },
  { code: 'SP3', label: 'Thermoplaste', group: 'kunststoff', lines: true },

  { code: 'L1', label: 'Wasser', group: 'fluessig' },
  { code: 'L2', label: 'Öl', group: 'fluessig' },
  { code: 'L3', label: 'Fett', group: 'fluessig' },
  { code: 'L4', label: 'Kraftstoff', group: 'fluessig' },

  { code: 'SN51', label: 'Glas', group: 'sonstige' },
  { code: 'SN52', label: 'Faser', group: 'sonstige' },
  { code: 'SN53', label: 'Keramik', group: 'sonstige', lines: true },
  { code: 'SN54', label: 'Porzellan', group: 'sonstige', lines: true },
  { code: 'SN55', label: 'Dämmstoff', group: 'sonstige' },
  { code: 'SN56', label: 'Füllstoff', group: 'sonstige' },
  { code: 'SN57', label: 'Schamotte', group: 'sonstige' },
  { code: 'SN58', label: 'Isolierstoff', group: 'sonstige', lines: true },
  { code: 'SN59', label: 'Dichtstoff', group: 'sonstige' },
];

export const dinPattern = (code: string) => `din-${code}` as HatchPattern;
export const dinCode = (pattern: string): string | null => (pattern.startsWith('din-') ? pattern.slice(4) : null);
export const dinHatch = (pattern: string): DinHatch | undefined => {
  const code = dinCode(pattern);
  return code ? DIN_HATCHES.find((h) => h.code === code) : undefined;
};

export interface Pt {
  x: number;
  y: number;
}
/** Linie einer Schar: Versatz quer, Strichmuster (Strich, Lücke, Strich, Lücke …), Verschiebung längs, bzw. Punkte im Abstand */
export interface LineSpec {
  at: number;
  dash?: number[];
  phase?: number;
  dots?: number;
}
/** Zeichenwerkzeuge je Rasterzelle (im gedrehten Bezugssystem des Musters: x nach rechts, y nach unten) */
export interface CellTools {
  add(a: Pt, b: Pt): void;
  dot(p: Pt): void;
  /** Kreis als Linie */
  ring(c: Pt, r: number, n?: number): void;
  /** gefüllter Kreis */
  disc(c: Pt, r: number): void;
  /** gefülltes Rechteck */
  rect(x: number, y: number, w: number, h: number): void;
}
/** Bausteine, aus denen die Schraffuren aufgebaut sind (stellt hatchGeometry bereit; der Winkel ist schon eingerechnet) */
export interface HatchTools {
  /** Grundmaß des Musters (gewählter Abstand) */
  s: number;
  /** Schar paralleler Linien in Richtung `deg` (0 = waagrecht, 90 = senkrecht, 45 = „\“, 135 = „/“), Wiederholung `period` */
  lines(deg: number, period: number, specs: LineSpec[]): void;
  /** Rasterzellen cw × ch: je Zelle Zeichen setzen */
  cells(cw: number, ch: number, cell: (i: number, j: number, x: number, y: number, t: CellTools) => void): void;
  /** Wellen- bzw. Zickzacklinien in Reihen */
  wave(rowH: number, amp: number, period: number, zig: boolean): void;
  /** Dämmstoff: Schlaufenband über die ganze Dicke der Schicht, entlang ihrer Längsrichtung */
  insulation(): void;
  /** Dichtstoff: schwarz-weißes Band entlang der Fuge über ihre ganze Breite */
  sealant(): void;
}

const at = (...v: number[]): LineSpec[] => v.map((x) => ({ at: x }));
const FWD = 135; // „/“
const BACK = 45; // „\“

/** Zeichnet die Schraffur `code` mit den Bausteinen `t`; false = unbekanntes Kurzzeichen */
export function drawDin(code: string, t: HatchTools): boolean {
  const s = t.s;
  const m = (...v: number[]) => v.map((x) => x * s);
  const scaled = (specs: LineSpec[]): LineSpec[] => specs.map((l) => ({ at: l.at * s, ...(l.dash ? { dash: m(...l.dash) } : {}), ...(l.phase !== undefined ? { phase: l.phase * s } : {}), ...(l.dots ? { dots: l.dots * s } : {}) }));
  /** Linienschar mit Maßen in Vielfachen von s */
  const L = (deg: number, period: number, specs: LineSpec[]) => t.lines(deg, period * s, scaled(specs));
  const both = (a: number, b: number, period: number, specs: LineSpec[]) => {
    L(a, period, specs);
    L(b, period, specs);
  };
  switch (code) {
    case 'U':
    case 'S':
      L(FWD, 1, at(0));
      return true;
    case 'SN':
      L(0, 1.15, at(0));
      return true;
    case 'SM':
      L(FWD, 2, at(0, 0.62));
      return true;
    case 'SP':
      both(FWD, BACK, 1.25, at(0));
      return true;
    case 'L':
      L(0, 1.8, [
        { at: 0, dash: [2.2, 0.8] },
        { at: 0.9, dash: [2.2, 0.8], phase: 1.5 },
      ]);
      return true;
    case 'G':
      t.cells(1.5 * s, 1.5 * s, (_i, _j, x, y, c) => c.ring({ x: x + 0.75 * s, y: y + 0.75 * s }, 0.6 * s, 14));
      return true;

    // ---- flüssige Stoffe ----
    case 'L1':
      L(0, 4.4, [{ at: 0 }, { at: 0.8, dash: [1.8, 0.7] }, { at: 1.6, dash: [1.8, 0.7], phase: 1.25 }, { at: 2.8, dash: [1.8, 0.7] }, { at: 3.6, dash: [1.8, 0.7], phase: 1.25 }]);
      return true;
    case 'L2':
      L(0, 3.3, [{ at: 0 }, { at: 0.45 }, { at: 1.35, dash: [2.6, 0.9] }, { at: 2.35, dash: [2.6, 0.9], phase: 1.75 }]);
      return true;
    case 'L3':
      t.cells(2.6 * s, 1.2 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.3 * s : 0);
        c.ring({ x: o, y }, 0.26 * s, 10);
        c.add({ x: o + 0.26 * s, y }, { x: o + 2.34 * s, y });
      });
      return true;
    case 'L4':
      L(0, 2.2, [{ at: 0 }, { at: 1.1, dash: [1.8, 0.45, 0.15, 0.45] }]);
      return true;

    // ---- Metalle ----
    case 'SM1':
      L(FWD, 1.7, [{ at: 0 }, { at: 0.85, dash: [2, 0.7] }]);
      return true;
    case 'SM2':
      L(FWD, 2.55, [{ at: 0 }, { at: 0.85, dash: [2, 0.7] }, { at: 1.7, dash: [2, 0.7], phase: 1.35 }]);
      return true;
    case 'SM3':
      L(FWD, 3, [{ at: 0 }, { at: 0.6 }, { at: 1.8, dash: [2, 0.8] }]);
      return true;
    case 'SM11':
      L(FWD, 1.7, [
        { at: 0, dash: [1.6, 0.6] },
        { at: 0.85, dash: [1.6, 0.6], phase: 1.1 },
      ]);
      return true;
    case 'SM12':
      L(FWD, 2.8, [{ at: 0 }, { at: 0.7 }, { at: 1.4 }, { at: 2.1, dash: [1.6, 0.6] }]);
      return true;

    // ---- Kunststoffe ----
    case 'SP1':
      // „\“-Linien, darauf versetzt kurze Querstriche (Kreuze)
      L(BACK, 2, at(0));
      L(FWD, 2, [
        { at: 0, dash: [0.9, 3.1], phase: -0.45 },
        { at: 1, dash: [0.9, 3.1], phase: 1.55 },
      ]);
      return true;
    case 'SP2':
      both(FWD, BACK, 2.3, at(0, 0.55));
      return true;
    case 'SP3':
      both(FWD, BACK, 2.3, [{ at: 0 }, { at: 0.55, dash: [0.8, 0.5] }]);
      return true;

    // ---- Boden, Gestein ----
    case 'SN1':
      L(0, 2.4, at(0));
      t.cells(0.55 * s, 2.4 * s, (_i, _j, x, y, c) => c.add({ x: x + 0.27 * s, y }, { x: x + 0.27 * s, y: y + 0.9 * s }));
      return true;
    case 'SN2':
      L(0, 2.4, at(0));
      t.cells(2.4 * s, 2.4 * s, (_i, _j, x, y, c) => {
        for (const u of [0.3, 0.75]) c.add({ x: x + u * s, y }, { x: x + u * s, y: y + 0.9 * s });
        for (const v of [0.25, 0.5, 0.75]) c.add({ x: x + 1.15 * s, y: y + v * s }, { x: x + 2.1 * s, y: y + v * s });
      });
      return true;
    case 'SN3':
      L(0, 1.3, at(0));
      t.cells(3 * s, 1.3 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.5 * s : 0);
        c.add({ x: o + 0.55 * s, y }, { x: o, y: y + 1.3 * s });
      });
      return true;
    case 'SN4':
      t.cells(3 * s, 1.6 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.5 * s : 0);
        const p = { x: o + 1.5 * s, y: y + 0.8 * s };
        c.ring(p, 0.42 * s, 12);
        c.dot(p);
        c.add({ x: o + 2.45 * s, y: y + 1.22 * s }, { x: o + 3.55 * s, y: y + 1.22 * s });
      });
      return true;
    case 'SN5':
      t.cells(2.4 * s, 1.2 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.2 * s : 0);
        c.add({ x: o + 0.1 * s, y }, { x: o + 1.5 * s, y });
        c.dot({ x: o + 2 * s, y: y + 0.6 * s });
      });
      return true;
    case 'SN6':
      t.cells(2.6 * s, 1.5 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.3 * s : 0);
        c.disc({ x: o + 0.55 * s, y: y + 0.6 * s }, 0.36 * s);
        c.disc({ x: o + 1.4 * s, y: y + 0.6 * s }, 0.36 * s);
        c.add({ x: o + 0.1 * s, y: y + 1.02 * s }, { x: o + 1.85 * s, y: y + 1.02 * s });
      });
      return true;
    case 'SN7':
      L(0, 4, [{ at: 0, dash: [2.2, 0.8] }, { at: 1 }, { at: 2, dash: [2.2, 0.8], phase: 1.5 }, { at: 3 }]);
      return true;
    case 'SN8':
      L(0, 4.2, [{ at: 0 }, { at: 0.35 }, { at: 1, dash: [1.6, 0.6] }, { at: 1.6, dash: [1.6, 0.6], phase: 1.1 }, { at: 2.3 }, { at: 2.9, dash: [1.6, 0.6] }, { at: 3.5, dash: [1.6, 0.6], phase: 1.1 }]);
      return true;
    case 'SN9':
      t.cells(3 * s, 1.7 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.5 * s : 0);
        c.disc({ x: o + s, y: y + 0.55 * s }, 0.4 * s);
        c.add({ x: o + 0.3 * s, y: y + 0.97 * s }, { x: o + 1.7 * s, y: y + 0.97 * s });
        c.add({ x: o + 2.1 * s, y: y + 1.45 * s }, { x: o + 2.8 * s, y: y + 1.45 * s });
      });
      return true;
    case 'SN10':
      // schwarze Felder, dazwischen helle „Steine“ – je Reihe versetzt
      t.cells(4 * s, 1.2 * s, (_i, j, x, y, c) => c.rect(x + (((j % 3) + 3) % 3) * 1.35 * s + 2.3 * s, y + 0.07 * s, 1.7 * s, 1.06 * s));
      return true;
    case 'SN11':
      L(0, 1.3, at(0));
      t.cells(6 * s, 1.3 * s, (_i, j, x, y, c) => {
        const o = x + (((j % 3) + 3) % 3) * 2.1 * s;
        for (let k = 0; k < 4; k++) c.add({ x: o + k * 0.38 * s, y }, { x: o + k * 0.38 * s, y: y + 1.3 * s });
        c.add({ x: o + 3.4 * s, y }, { x: o + 3.4 * s, y: y + 1.3 * s });
      });
      return true;
    case 'SN12':
      L(0, 1.1, at(0));
      t.cells(3 * s, 1.1 * s, (_i, j, x, y, c) => c.ring({ x: x + (j % 2 ? 1.5 * s : 0) + 1.5 * s, y: y + 0.55 * s }, 0.15 * s, 8));
      return true;

    // ---- Holz, Bitumen, Teer ----
    case 'SN21':
      L(FWD, 5.6, at(0, 0.5, 1, 2.6, 4, 4.5));
      return true;
    case 'SN22':
      L(0, 3.8, at(0, 0.4, 0.8, 2.2));
      return true;
    case 'SN23':
      L(90, 1.3, at(0));
      return true;
    case 'SN24':
      t.wave(1.7 * s, 0.5 * s, 2.1 * s, false);
      return true;
    case 'SN25':
      t.wave(1.9 * s, 0.55 * s, 2.6 * s, true);
      return true;

    // ---- Mauerwerk, Beton, Gips ----
    case 'SN41':
      L(0, 2.2, at(0, 0.4, 1.3));
      return true;
    case 'SN42':
      L(0, 2.9, at(0, 0.35, 0.7, 1.6, 1.95));
      return true;
    case 'SN43':
      L(0, 2.4, [{ at: 0 }, { at: 1.2 }, { at: 1.55, dots: 0.5 }]);
      return true;
    case 'SN44':
      L(0, 3.4, [{ at: 0.3, dots: 0.5 }, { at: 0.85 }, { at: 1.5, dots: 0.5 }, { at: 1.95, dots: 0.5, phase: 0.25 }, { at: 2.4, dots: 0.5 }, { at: 2.95 }]);
      return true;
    case 'SN45':
      L(0, 1.9, [
        { at: 0, dots: 0.6 },
        { at: 0.55, dots: 0.6, phase: 0.3 },
      ]);
      return true;
    case 'SN46':
      L(FWD, 2.6, [{ at: 0 }, { at: 1.3, dash: [1.6, 0.8] }]);
      return true;
    case 'SN47':
      L(FWD, 2.6, [
        { at: 0, dash: [1.8, 0.8] },
        { at: 1.3, dash: [1.8, 0.8], phase: 1.3 },
      ]);
      return true;
    case 'SN48':
      L(FWD, 1.4, at(0));
      t.cells(4.6 * s, 4.2 * s, (_i, j, x, y, c) => c.ring({ x: x + (j % 2 ? 2.3 * s : 0) + 2.3 * s, y: y + 2.1 * s }, 0.6 * s, 16));
      return true;
    case 'SN49':
      L(FWD, 2.4, [{ at: 0 }, { at: 1.2, dash: [1.2, 0.4, 0.12, 0.4] }]);
      return true;
    case 'SN50':
      L(FWD, 3.6, [{ at: 0 }, { at: 1.2 }, { at: 2.4, dash: [2.4, 0.9] }]);
      return true;

    // ---- Glas, Keramik, Dämm- und Dichtstoffe ----
    case 'SN51':
      t.cells(3.4 * s, 2.2 * s, (_i, j, x, y, c) => {
        const o = x + (j % 2 ? 1.7 * s : 0);
        for (let k = 0; k < 3; k++) c.add({ x: o + (0.3 + k * 0.45) * s, y: y + 1.6 * s }, { x: o + (1.2 + k * 0.45) * s, y: y + 0.6 * s });
      });
      return true;
    case 'SN52':
      L(0, 1.5, at(0));
      t.cells(0.5 * s, 1.5 * s, (_i, _j, x, y, c) => c.add({ x: x + 0.25 * s, y }, { x: x + 0.25 * s, y: y - 0.45 * s }));
      return true;
    case 'SN53':
      both(0, 90, 2, at(0, 0.3, 1.1));
      return true;
    case 'SN54':
      both(0, 90, 1.9, at(0, 0.35));
      return true;
    case 'SN55':
      t.insulation();
      return true;
    case 'SN56':
      L(0, 1.3, at(0));
      t.cells(1.3 * s, 1.3 * s, (_i, j, x, y, c) => c.ring({ x: x + (j % 2 ? 0.65 * s : 0) + 0.65 * s, y: y + 0.65 * s }, 0.62 * s, 14));
      return true;
    case 'SN57':
      t.cells(2.3 * s, 2.3 * s, (_i, _j, x, y, c) => {
        const cx = x + 1.15 * s;
        const cy = y + 1.15 * s;
        for (const d of [-0.22, 0.22]) {
          c.add({ x: cx + d * s, y: cy - 0.5 * s }, { x: cx + d * s, y: cy + 0.5 * s });
          c.add({ x: cx - 0.5 * s, y: cy + d * s }, { x: cx + 0.5 * s, y: cy + d * s });
        }
      });
      return true;
    case 'SN58':
      both(FWD, BACK, 1.9, at(0));
      return true;
    case 'SN59':
      t.sealant();
      return true;
    default:
      return false;
  }
}
