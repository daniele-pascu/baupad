import { describe, expect, it } from 'vitest';
import { addSite, assign, carryOver, emptyWeek, isoWeekNo, moveWorker, setVacation, siteFromProject, sitesOf, unassign, unassigned, updateSite, weekOf, weekRange } from '../../src/lib/crew';
import type { Worker } from '../../src/lib/types';

const W = (id: string, active = true): Worker => ({ id, firstName: id, lastName: '', active, createdAt: 0, updatedAt: 0 });
const workers = [W('max'), W('peter'), W('tom'), W('alt', false)];

function twoSites() {
  let w = emptyWeek('2026-10-26');
  const a = addSite(w, { projectId: null, name: 'Baustelle A' });
  const b = addSite(a.week, { projectId: null, name: 'Baustelle B' });
  w = b.week;
  return { w, a: a.site.id, b: b.site.id };
}

describe('Arbeitereinteilung', () => {
  it('Woche: Montag als Schlüssel, Kalenderwoche nach ISO, Zeitraum', () => {
    expect(weekOf('2026-10-29')).toBe('2026-10-26'); // Donnerstag → Montag
    expect(weekOf('2026-11-01')).toBe('2026-10-26'); // Sonntag gehört zur selben Woche
    expect(isoWeekNo('2026-10-26')).toBe(44);
    expect(isoWeekNo(weekOf('2026-01-01'))).toBe(1); // 1.1.2026 ist Donnerstag → KW 1
    expect(isoWeekNo(weekOf('2027-01-01'))).toBe(53); // 1.1.2027 (Freitag) gehört noch zu KW 53/2026
    expect(weekRange('2026-10-26')).toBe('26.10. – 30.10.2026');
  });

  it('einteilen, austragen; Änderung an einer Baustelle lässt die andere unverändert', () => {
    let { w, a, b } = twoSites();
    w = assign(w, a, [0, 1, 2, 3, 4], ['max', 'peter']);
    w = assign(w, b, [0], ['tom']);
    const before = JSON.stringify(w.sites.find((s) => s.id === b));
    w = unassign(w, a, 1, 'peter');
    expect(w.sites[0].days[1]).toEqual(['max']);
    expect(w.sites[0].days[0]).toEqual(['max', 'peter']);
    expect(JSON.stringify(w.sites.find((s) => s.id === b))).toBe(before);
    // doppelt einteilen legt keinen zweiten Eintrag an
    expect(assign(w, a, [0], ['max']).sites[0].days[0]).toEqual(['max', 'peter']);
  });

  it('Konflikt: derselbe Arbeiter am selben Tag auf zwei Baustellen wird erkannt', () => {
    let { w, a, b } = twoSites();
    w = assign(w, a, [0], ['max']);
    expect(sitesOf(w, 'max', 0, b).map((s) => s.name)).toEqual(['Baustelle A']);
    expect(sitesOf(w, 'max', 1, b)).toEqual([]);
  });

  it('ab einem Tag auf eine andere Baustelle verschieben', () => {
    let { w, a, b } = twoSites();
    w = assign(w, a, [0, 1, 2, 3, 4], ['max']);
    w = moveWorker(w, 'max', a, b, 2); // ab Mittwoch
    expect(w.sites[0].days.map((d) => d.includes('max'))).toEqual([true, true, false, false, false, false, false]);
    expect(w.sites[1].days.map((d) => d.includes('max'))).toEqual([false, false, true, true, true, false, false]);
  });

  it('Urlaub: nimmt den Arbeiter an dem Tag von der Baustelle; noch nicht Eingeteilte ohne Urlaub und Inaktive', () => {
    let { w, a } = twoSites();
    w = assign(w, a, [0, 1], ['max', 'peter']);
    w = setVacation(w, 'peter', [1], true);
    expect(w.sites[0].days[1]).toEqual(['max']);
    expect(unassigned(w, workers, 0).map((x) => x.id)).toEqual(['tom']); // „alt“ ist inaktiv
    expect(unassigned(w, workers, 1).map((x) => x.id)).toEqual(['tom']); // peter hat Urlaub
    // wieder einteilen hebt den Urlaub auf
    w = assign(w, a, [1], ['peter']);
    expect(w.vacation[1]).toEqual([]);
  });

  it('nächste Woche läuft weiter: gleiche Baustellen und Arbeiter, fertiggestellte nicht, Vorwoche unverändert', () => {
    let { w, a, b } = twoSites();
    w = assign(w, a, [0, 1, 2, 3, 4], ['max', 'peter']);
    w = assign(w, b, [0, 1], ['tom']);
    w = setVacation(w, 'tom', [4], true);
    w = updateSite(w, b, { finished: true });
    const prev = JSON.stringify(w);
    const next = carryOver(w, '2026-11-02');
    expect(next.id).toBe('2026-11-02');
    expect(next.sites.map((s) => s.name)).toEqual(['Baustelle A']);
    expect(next.sites[0].days[3]).toEqual(['max', 'peter']);
    expect(next.vacation.flat()).toEqual([]); // Urlaub nicht übernommen
    // neue Woche unabhängig bearbeitbar
    const changed = unassign(next, next.sites[0].id, 0, 'max');
    expect(changed.sites[0].days[0]).toEqual(['peter']);
    expect(JSON.stringify(w)).toBe(prev);
    expect(next.sites[0].id).not.toBe(a);
  });

  it('Baustelle aus Projekt: Name, Nummer und Adresse zum Zeitpunkt der Einteilung', () => {
    expect(siteFromProject({ id: 'p1', name: 'Neubau Musterstraße', number: '2026-04', address: 'Musterstraße 1' })).toEqual({
      projectId: 'p1',
      name: 'Neubau Musterstraße',
      number: '2026-04',
      address: 'Musterstraße 1',
    });
  });
});

describe('Tage kompakt', () => {
  it('Bereiche und Einzeltage', async () => {
    const { dayList } = await import('../../src/lib/crew');
    expect(dayList([0, 1, 2, 3, 4])).toBe('Mo–Fr');
    expect(dayList([0, 2])).toBe('Mo, Mi');
    expect(dayList([1, 2, 3, 5])).toBe('Di–Do, Sa');
    expect(dayList([0, 1])).toBe('Mo, Di');
  });
});

describe('Umsetzen (Ziehen / Hinzufügen)', () => {
  it('ab einem Tag auf eine andere Baustelle: von der bisherigen automatisch entfernt, Urlaub bleibt', async () => {
    const { placeWorker } = await import('../../src/lib/crew');
    let { w, a, b } = twoSites();
    w = assign(w, a, [0, 1, 2, 3, 4], ['max', 'peter']);
    w = setVacation(w, 'max', [3], true);
    const r = placeWorker(w, 'max', b, [1, 2, 3, 4]); // ab Dienstag
    expect(r.from).toEqual(['Baustelle A']);
    expect(r.week.sites[0].days.map((d) => d.includes('max'))).toEqual([true, false, false, false, false, false, false]);
    expect(r.week.sites[1].days.map((d) => d.includes('max'))).toEqual([false, true, true, false, true, false, false]); // Do = Urlaub
    expect(r.week.vacation[3]).toEqual(['max']);
    expect(r.week.sites[0].days[2]).toEqual(['peter']); // andere Arbeiter unverändert
  });

  it('noch nicht eingeteilt → wird einfach eingeteilt; Urlaub nur auf Wunsch aufgehoben', async () => {
    const { placeWorker } = await import('../../src/lib/crew');
    let { w, b } = twoSites();
    w = setVacation(w, 'tom', [0], true);
    expect(placeWorker(w, 'tom', b, [0, 1]).week.sites[1].days.slice(0, 2)).toEqual([[], ['tom']]);
    const o = placeWorker(w, 'tom', b, [0], true).week;
    expect(o.sites[1].days[0]).toEqual(['tom']);
    expect(o.vacation[0]).toEqual([]);
  });

  it('bereits geplante Folgewoche: gleiche Baustelle über Projekt bzw. Name, sonst unverändert', async () => {
    const { placeInWeek } = await import('../../src/lib/crew');
    let { w, a, b } = twoSites();
    w = assign(w, a, [0, 1, 2, 3, 4], ['max']);
    const next = carryOver(w, '2026-11-02');
    const moved = placeInWeek(next, 'max', { projectId: null, name: 'baustelle b' }, [0, 1, 2, 3, 4])!;
    expect(moved.sites.find((s) => s.name === 'Baustelle B')!.days[4]).toEqual(['max']);
    expect(moved.sites.find((s) => s.name === 'Baustelle A')!.days[4]).toEqual([]);
    expect(placeInWeek(next, 'max', { projectId: null, name: 'Gibt es nicht' }, [0])).toBeNull();
    expect(b).toBeTruthy();
  });
});
