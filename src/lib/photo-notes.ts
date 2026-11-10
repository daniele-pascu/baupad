import { damageNo } from './numbering';
import type { Damage } from './types';

/**
 * Fotos einer Messung tragen in der Fotodokumentation den Vermerk „Aufmaß <Plan> Nr. <Nummer>“.
 * Das Foto hängt an der Messung (nicht an der Nummer); ändert sich die Nummer (Umnummerieren, Tauschen,
 * Lücken schließen, Rückgängig) oder die Plannummer, wird der Vermerk nachgezogen.
 * Nur automatisch erzeugte Vermerke werden geändert – eigene Beschreibungen bleiben.
 */
const AUTO = /^Aufmaß .+ Nr\. .+$/;

export const photoNote = (prefix: string, d: Pick<Damage, 'number' | 'label'>) => `${prefix} Nr. ${damageNo(d)}`;

export function photoNoteUpdates(
  prefix: string,
  damages: Pick<Damage, 'number' | 'label' | 'photoIds' | 'deletedAt'>[],
  photos: { id: string; description: string }[],
): { id: string; description: string }[] {
  const want = new Map<string, string>();
  for (const d of damages) if (!d.deletedAt) for (const id of d.photoIds ?? []) if (!want.has(id)) want.set(id, photoNote(prefix, d));
  const out: { id: string; description: string }[] = [];
  for (const p of photos) {
    const w = want.get(p.id);
    const cur = p.description.trim();
    if (w && cur !== w && AUTO.test(cur)) out.push({ id: p.id, description: w });
  }
  return out;
}
