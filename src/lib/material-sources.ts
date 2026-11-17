import { lvDocsOf, positionRef } from './aufmass';
import type { ProjectData } from './db';
import { measuredForPosition } from './lv-measured';
import { normUnit, quantityOfMeasure, typeInfo, typeOf } from './measure-types';
import { alive, type ProjectState } from './store';

/**
 * Mengen einer Baustelle für die Materialrechnung – automatisch aus dem Aufmaß und dem LV:
 * Summen je Messart (Fläche, Wand, Schadstelle, Länge …) und gesamt je Einheit, je LV-Position die Menge laut LV
 * und die gemessene Menge. Die Materialrechnung merkt sich die Kennung und zieht die Menge nach, wenn sich das
 * Aufmaß ändert.
 */
export interface QtySource {
  /** Kennung, z. B. „aufmass:m²“, „typ:wand“, „lv:<Dokument>:<Position>“, „lvm:<Dokument>:<Position>“ */
  id: string;
  label: string;
  value: number;
  /** Einheit vereinheitlicht: m², m, m³, Stk (oder eigene Einheit) */
  unit: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Projektdaten aus der Datenbank als Projektzustand (wie im Aufmaß geöffnet) */
export function stateOf(data: ProjectData): ProjectState {
  const rec = <T extends { id: string }>(arr: T[] | undefined) => Object.fromEntries((arr ?? []).map((x) => [x.id, x])) as Record<string, T>;
  return {
    project: data.project,
    costCenters: rec(data.costCenters),
    files: rec(data.files),
    plans: rec(data.plans),
    damages: rec(data.damages),
    components: rec(data.components),
    elements: rec(data.elements),
    lvDocs: rec(data.lvDocs),
  };
}

export function aufmassSources(data: ProjectState): QtySource[] {
  const out: QtySource[] = [];
  const livePlans = new Set(alive(data.plans).map((p) => p.id));
  const damages = alive(data.damages).filter((d) => livePlans.has(d.planId));
  // je Messart und Einheit, dazu gesamt je Einheit (wenn mehrere Messarten dieselbe Einheit haben)
  const byType = new Map<string, { label: string; unit: string; value: number }>();
  const byUnit = new Map<string, { value: number; types: Set<string> }>();
  for (const d of damages) {
    const q = quantityOfMeasure(d);
    const unit = normUnit(q.unit);
    if (q.value === null || !unit) continue;
    const t = typeOf(d);
    const k = `${t}|${unit}`;
    const e = byType.get(k) ?? { label: typeInfo(t).label, unit, value: 0 };
    e.value += q.value;
    byType.set(k, e);
    const u = byUnit.get(unit) ?? { value: 0, types: new Set<string>() };
    u.value += q.value;
    u.types.add(t);
    byUnit.set(unit, u);
  }
  for (const [unit, u] of byUnit) if (u.value > 0) out.push({ id: `aufmass:${unit}`, label: u.types.size > 1 ? 'Aufmaß: alle Messungen' : `Aufmaß: ${[...byType.values()].find((x) => x.unit === unit)!.label}`, value: round(u.value), unit });
  for (const [k, e] of byType) if (e.value > 0 && (byUnit.get(e.unit)?.types.size ?? 0) > 1) out.push({ id: `typ:${k}`, label: `Aufmaß: ${e.label}`, value: round(e.value), unit: e.unit });
  // LV-Positionen: Menge laut LV (geplant) und gemessen
  for (const doc of lvDocsOf(data)) {
    for (const pos of doc.positions) {
      const unit = normUnit(pos.unit || '');
      if (!unit) continue;
      const title = [`Pos. ${pos.number}`, pos.shortText].filter(Boolean).join(' ');
      const ref = positionRef(doc.id, pos.id);
      if (pos.quantity !== null && pos.quantity > 0) out.push({ id: `lv:${ref}`, label: `${title} – laut LV`, value: round(pos.quantity), unit });
      const m = measuredForPosition(data, doc, pos);
      if (m.value !== null && m.value > 0) out.push({ id: `lvm:${ref}`, label: `${title} – gemessen`, value: round(m.value), unit });
    }
  }
  return out;
}
