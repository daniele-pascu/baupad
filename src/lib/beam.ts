import type { Beam } from './types';
import { formatMeasure } from './numbers';

/** gezählte Flächen eines Unterzugs in fester Reihenfolge: Seite 1, Unterseite, Seite 2 */
const parts = (b: Beam) =>
  [
    ['Seite 1', b.a],
    ['Unterseite', b.bottom],
    ['Seite 2', b.b],
  ].filter((x): x is [string, number] => typeof x[1] === 'number' && x[1] > 0);

/** Abwicklung eines Unterzugs (m): Summe der gezählten Flächen */
export const beamDeveloped = (b: Beam): number => Math.round(parts(b).reduce((s, [, v]) => s + v, 0) * 1e9) / 1e9;

/** Rechenweg der Abwicklung, z. B. „0,50 + 0,30 + 0,50 = 1,30 m“ */
export const beamFormula = (b: Beam): string => `${parts(b).map(([, v]) => formatMeasure(v)).join(' + ') || '0'} = ${formatMeasure(beamDeveloped(b))} m`;

/** Kurzbeschreibung für Tabelle und Export, z. B. „Unterzug: Seite 1 0,50 + Unterseite 0,30 + Seite 2 0,50“ */
export const beamText = (b: Beam): string => `Unterzug: ${parts(b).map(([k, v]) => `${k} ${formatMeasure(v)}`).join(' + ')}`;

/** Bemerkung einer Messung mit Unterzug-Angabe davor (Tabelle, Excel) */
export const noteWithBeam = (d: { note?: string | null; beam?: Beam | null }): string =>
  [d.beam ? beamText(d.beam) : '', d.note?.trim() ?? ''].filter(Boolean).join(' · ');
