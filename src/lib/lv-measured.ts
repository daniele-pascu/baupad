import { positionRef } from './aufmass';
import { quantityFor } from './measure';
import { activeRule, bookedForPosition } from './pos-rules';
import type { ProjectState } from './store';
import type { LvDocument, LvPosition } from './types';

/**
 * Aufmaßmenge und -betrag einer LV-Position aus den zugeordneten Messungen – von Hand zugeordnet und
 * Schadstellen, die über die Regel der Position automatisch zählen (LV-Ansicht und Materialbedarf).
 */
export function measuredForPosition(data: ProjectState, doc: LvDocument, pos: LvPosition) {
  const booked = bookedForPosition(data, positionRef(doc.id, pos.id));
  const damages = booked.map((b) => b.d);
  let q = quantityFor(pos.unit, damages);
  const rebar = !!activeRule(pos)?.rebar;
  if (rebar || booked.some((b) => b.factor !== 1)) {
    // Zulage: jede Schadstelle zählt mit ihrer Stufenzahl · Bewehrung: die bei der Schadstelle eingetragenen lfm
    let value: number | null = null;
    let missing = 0;
    for (const b of booked) {
      const one = rebar && b.auto ? { value: b.d.rebar ?? null, missing: 0 } : quantityFor(pos.unit, [b.d]);
      missing += one.missing;
      if (one.value !== null) value = (value ?? 0) + b.factor * one.value;
    }
    q = { value: value === null ? null : Math.round(value * 1e6) / 1e6, missing };
  }
  return { damages, booked, ...q, amount: q.value !== null && pos.unitPrice !== null ? Math.round(q.value * pos.unitPrice * 100) / 100 : null };
}
