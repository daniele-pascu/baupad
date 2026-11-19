import { costCenterName, planTitle } from './aufmass';
import { putRecords, type ProjectState } from './store';

/**
 * Papierkorb im Aufmaß-Projekt: Gelöschtes ist nur als gelöscht markiert (deletedAt). Was mit einem Mal gelöscht
 * wurde (Plan mit seinen Messungen, Kostenstelle mit ihren Plänen, LV, Originalplan), trägt denselben Zeitpunkt –
 * daraus entsteht je Löschung ein Eintrag, der sich 30 Tage lang als Ganzes wiederherstellen lässt.
 * Einzeln gelöschte Messungen stehen nicht im Papierkorb (dafür gibt es „Rückgängig“ im Plan).
 */
export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type Store = 'costCenters' | 'files' | 'plans' | 'damages' | 'components' | 'elements' | 'lvDocs';
const STORES: Store[] = ['costCenters', 'plans', 'damages', 'components', 'elements', 'files', 'lvDocs'];

export interface TrashEntry {
  /** Zeitpunkt der Löschung (gemeinsam für alles, was mit einem Mal gelöscht wurde) */
  at: number;
  /** Bezeichnung für die Liste, z. B. „Plan T-1 – Parkdeck“ */
  title: string;
  /** Zusatz, z. B. „3 Messungen“ */
  detail: string;
  /** noch so viele Tage wiederherstellbar */
  daysLeft: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Einträge des Papierkorbs (jüngste zuerst) */
export function trashEntries(data: ProjectState, now = Date.now()): TrashEntry[] {
  const since = now - TRASH_DAYS * DAY;
  const at = (r: { deletedAt: number | null }) => (r.deletedAt && r.deletedAt >= since ? r.deletedAt : null);
  const byTime = new Map<number, { [S in Store]: ProjectState[S][string][] }>();
  for (const store of STORES) {
    for (const r of Object.values(data[store]) as { deletedAt: number | null }[]) {
      const t = at(r);
      if (t === null) continue;
      const g = byTime.get(t) ?? { costCenters: [], plans: [], damages: [], components: [], elements: [], files: [], lvDocs: [] };
      (g[store] as unknown[]).push(r);
      byTime.set(t, g);
    }
  }
  const out: TrashEntry[] = [];
  for (const [t, g] of byTime) {
    const daysLeft = Math.max(1, Math.ceil((t + TRASH_DAYS * DAY - now) / DAY));
    const measures = g.damages.length;
    if (g.costCenters.length) {
      out.push({ at: t, title: `Kostenstelle ${g.costCenters.map((c) => costCenterName(c)).join(', ')}`, detail: [plural(g.plans.length, 'Plan', 'Pläne'), plural(measures, 'Messung', 'Messungen')].join(' · '), daysLeft });
    } else if (g.plans.length) {
      out.push({
        at: t,
        title: g.plans.length === 1 ? `Plan ${planTitle(g.plans[0])}` : `${g.plans.length} Pläne: ${g.plans.map((p) => p.planNumber || planTitle(p)).join(', ')}`,
        detail: plural(measures, 'Messung', 'Messungen'),
        daysLeft,
      });
    } else if (g.lvDocs.length) {
      out.push({ at: t, title: g.lvDocs.length === 1 ? `LV/MFK „${g.lvDocs[0].name}“` : `${g.lvDocs.length} LV/MFK`, detail: plural(g.lvDocs.reduce((n, d) => n + d.positions.length, 0), 'Position', 'Positionen'), daysLeft });
    } else if (g.files.length) {
      out.push({ at: t, title: `Originalplan „${g.files.map((f) => f.name).join('“, „')}“`, detail: 'aus der Planbibliothek', daysLeft });
    }
    // nur Messungen, Bauteile oder Zeichnungsobjekte: kein Eintrag (Rückgängig im Plan)
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Alles, was zu diesem Zeitpunkt gelöscht wurde, wiederherstellen */
export function restoreTrash(data: ProjectState, at: number): void {
  const items: { [S in Store]?: ProjectState[S][string][] } = {};
  for (const store of STORES) {
    const list = (Object.values(data[store]) as { deletedAt: number | null }[]).filter((r) => r.deletedAt === at).map((r) => ({ ...r, deletedAt: null }));
    if (list.length) (items as Record<string, unknown[]>)[store] = list;
  }
  putRecords(items as Parameters<typeof putRecords>[0], { history: false });
}
