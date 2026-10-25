import type { Damage, DrawElement, LayerId, Plan } from './types';

export type { LayerId };

/**
 * Ebenen: Zeichnung, Bemaßung, Text und Messungen lassen sich je Plan ausblenden. Ausgeblendete
 * Ebenen erscheinen weder in der Ansicht noch im PDF, sind nicht fang- oder auswählbar und
 * werden von Bearbeitungsbefehlen nicht verändert. Die Daten bleiben unverändert gespeichert.
 */

export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: 'drawing', label: 'Zeichnung', hint: 'Linien, Flächen, Kreise und Bögen' },
  { id: 'dims', label: 'Bemaßung', hint: 'Maßlinien und Maßangaben der Objekte' },
  { id: 'text', label: 'Text', hint: 'Beschriftungen' },
  { id: 'measures', label: 'Messungen', hint: 'Aufmaß-Markierungen im Plan (die Tabelle bleibt vollständig)' },
];

export const layerOf = (e: Pick<DrawElement, 'type'>): LayerId => (e.type === 'dimension' ? 'dims' : e.type === 'text' ? 'text' : 'drawing');

export const isLayerHidden = (plan: Pick<Plan, 'hiddenLayers'> | null | undefined, id: LayerId) => !!plan?.hiddenLayers?.includes(id);

/**
 * Sichtbare Zeichnungsobjekte (gefiltert, nicht verändert – die Objekte dürfen weiter
 * gespeichert werden). Die automatischen Maßangaben steuert `dimsVisible`.
 */
export const visibleElements = <T extends Pick<DrawElement, 'type'>>(plan: Pick<Plan, 'hiddenLayers'> | null | undefined, elements: T[]): T[] =>
  plan?.hiddenLayers?.length ? elements.filter((e) => !isLayerHidden(plan, layerOf(e))) : elements;

/** Maßangaben der Objekte (Ebene „Bemaßung“) anzeigen */
export const dimsVisible = (plan: Pick<Plan, 'hiddenLayers'> | null | undefined) => !isLayerHidden(plan, 'dims');

/** Sichtbare Messungen (Ebene „Messungen“) */
export const visibleDamages = <T extends Pick<Damage, 'id'>>(plan: Pick<Plan, 'hiddenLayers'> | null | undefined, damages: T[]): T[] =>
  isLayerHidden(plan, 'measures') ? [] : damages;

/** Namen der ausgeblendeten Ebenen (für Hinweise) */
export const hiddenLayerNames = (plan: Pick<Plan, 'hiddenLayers'> | null | undefined) => LAYERS.filter((l) => isLayerHidden(plan, l.id)).map((l) => l.label);
