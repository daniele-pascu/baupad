import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addSite, assign, emptyWeek } from '../../src/lib/crew';
import { reportPdf } from '../../src/lib/report-pdf';
import { copyReport, crewForDay, headFromProject, hoursFromTimes, newReport, nextNo, siteKey, sumHours, workerRow } from '../../src/lib/reports';
import type { Report, Worker } from '../../src/lib/types';

const W = (id: string, firstName: string, role = ''): Worker => ({ id, firstName, lastName: 'Muster', role, active: true, createdAt: 0, updatedAt: 0 });
const workers = [W('a', 'Max', 'Polier'), W('b', 'Peter', 'Facharbeiter'), W('c', 'Thomas')];
const head = headFromProject({ name: 'Wohnanlage Sonnenhof', number: '2026-04', site: 'Sonnenhof Bauteil A', address: 'Musterstraße 1, 4020 Linz', client: 'Muster GmbH', editor: 'Ing. Huber' }, [{ number: '91092', name: 'Tiefgarage' }]);
const dir = mkdtempSync(join(tmpdir(), 'report-pdf-'));
const hasPoppler = (() => {
  try {
    execFileSync('which', ['pdftotext'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
})();
const text = (data: Uint8Array, name: string) => {
  writeFileSync(join(dir, name), data);
  return execFileSync('pdftotext', ['-layout', join(dir, name), '-'], { encoding: 'utf8' });
};

describe('Berichte – Grundlage', () => {
  it('Kopfdaten aus dem Projekt; Baustellen-Schlüssel und fortlaufende Nummer je Baustelle und Typ', () => {
    expect(head).toMatchObject({ project: 'Wohnanlage Sonnenhof', site: 'Sonnenhof Bauteil A', client: 'Muster GmbH', costCenter: '91092 – Tiefgarage', responsible: 'Ing. Huber' });
    const r1 = newReport('regie', { projectId: 'p1', head, date: '2026-10-28', all: [] });
    const r2 = newReport('regie', { projectId: 'p1', head, date: '2026-10-29', all: [r1] });
    const t1 = newReport('tag', { projectId: 'p1', head, date: '2026-10-28', all: [r1, r2] });
    const free = newReport('regie', { projectId: null, head: { ...head, site: 'Halle 3' }, date: '2026-10-28', all: [r1, r2] });
    expect([r1.no, r2.no, t1.no, free.no]).toEqual(['1', '2', '1', '1']);
    expect(siteKey(free)).toBe('n:halle 3');
    expect(nextNo([r1, r2, { ...t1, no: '7' } as Report], 'tag', 'p:p1')).toBe('8');
  });

  it('Wochenbericht: Montag bis Sonntag; Kopie verschiebt die Tage und behält die Kopfdaten', () => {
    const w = newReport('woche', { projectId: 'p1', head, date: '2026-10-29', all: [] });
    expect([w.date, w.dateTo]).toEqual(['2026-10-26', '2026-11-01']);
    if (w.type !== 'woche') throw new Error();
    expect(w.data.days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    w.data.days[0].work = 'Abbruch';
    const c = copyReport(w, '2026-11-04', [w]);
    expect(c.no).toBe('2');
    expect(c.status).toBe('draft');
    if (c.type !== 'woche') throw new Error();
    expect(c.data.days[0]).toMatchObject({ date: '2026-11-02', work: 'Abbruch' });
    expect(w.data.days[0].date).toBe('2026-10-26'); // Original unverändert
  });

  it('Stunden nur aus vorhandenen Angaben (nichts erfunden); über Mitternacht; Summe', () => {
    expect(hoursFromTimes('07:00', '16:00', '30')).toBe(8.5);
    expect(hoursFromTimes('22:00', '06:00', '')).toBe(8);
    expect(hoursFromTimes('07:00', '', '30')).toBeNull();
    expect(hoursFromTimes('07:00', '16:00', 'x')).toBeNull();
    const rows = [workerRow(workers[0], { from: '07:00', to: '16:00', pause: '30' }), workerRow(workers[1], { hours: 4 }), workerRow(workers[2])];
    expect(sumHours(rows)).toBe(12.5);
    expect(sumHours([workerRow(workers[2])])).toBeNull();
  });

  it('Mannschaft aus der Arbeitereinteilung: Baustelle über Projekt bzw. Name, Urlaub/krank gekennzeichnet', () => {
    let w = emptyWeek('2026-10-26');
    const a = addSite(w, { projectId: 'p1', name: 'Sonnenhof' });
    const b = addSite(a.week, { projectId: null, name: 'Halle 3' });
    w = assign(assign(b.week, a.site.id, [2], ['a', 'b']), b.site.id, [2], ['c']);
    const absences = [{ id: 'x', workerId: 'b', kind: 'krank' as const, from: '2026-10-28', to: '2026-10-28', createdAt: 0 }];
    const s = crewForDay(w, '2026-10-28', { projectId: 'p1', name: 'egal' }, workers, absences);
    expect(s.map((x) => [x.worker.firstName, x.absence])).toEqual([
      ['Max', null],
      ['Peter', 'krank'],
    ]);
    expect(crewForDay(w, '2026-10-28', { projectId: null, name: 'halle 3' }, workers, []).map((x) => x.worker.id)).toEqual(['c']);
    expect(crewForDay(w, '2026-10-27', { projectId: 'p1', name: '' }, workers, [])).toEqual([]);
    expect(crewForDay(null, '2026-10-28', { projectId: 'p1', name: '' }, workers, [])).toEqual([]);
  });
});

describe('Berichte – PDF', () => {
  it('Regieliste: Kopf, Personal mit Stunden und Summe, Tätigkeiten, Material; nur ausgefüllte Angaben', async () => {
    const r = newReport('regie', { projectId: 'p1', head, date: '2026-10-28', all: [] });
    if (r.type !== 'regie') throw new Error();
    r.data.workers = [workerRow(workers[0], { from: '07:00', to: '16:00', pause: '30' }), workerRow(workers[1], { hours: 4 })];
    r.data.work = 'Betonabplatzungen an Stütze B4 ausgebessert, auf Anordnung Bauleitung.';
    r.data.materials = [{ id: 'm', text: 'Reparaturmörtel', qty: 3, unit: 'Sack' }];
    const f = await reportPdf(r, { company: 'Muster Bau GmbH' });
    expect(f.name).toBe('Regieliste_Sonnenhof_Bauteil_A_Nr1_2026-10-28.pdf');
    const doc = await PDFDocument.load(f.data);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([842]); // A4 quer (Formular wie die Regietagesliste)
    if (!hasPoppler) return;
    const t = text(f.data, 'regie.pdf');
    for (const s of ['REGIELISTE Nr. 1', 'Muster Bau GmbH', 'Wohnanlage Sonnenhof', 'Musterstraße 1', 'Muster GmbH', '91092 – Tiefgarage', 'KW 44', 'PERSONAL', 'Arbeitszeiten', 'NAZ', 'Max Muster', '8,5', '12,5', 'GERÄT', 'Reparaturm', 'Sack', 'Anmerkungen', 'Auftraggeber / Kontrolle'])
      expect(t).toContain(s);
  });

  it('Tagesbericht: nur anwesende Arbeiter; Wochenbericht: Tage mit Inhalt; lange Texte über mehrere Seiten', async () => {
    const t = newReport('tag', { projectId: 'p1', head, date: '2026-10-28', all: [] });
    if (t.type !== 'tag') throw new Error();
    t.data.crew = [workerRow(workers[0], { present: true }), workerRow(workers[1], { present: false, planned: true })];
    t.data.weather = 'bewölkt';
    t.data.work = Array.from({ length: 120 }, (_, i) => `Zeile ${i + 1}: Arbeiten im Bereich Tiefgarage durchgeführt.`).join('\n');
    const ft = await reportPdf(t);
    expect((await PDFDocument.load(ft.data)).getPageCount()).toBeGreaterThan(1);
    const w = newReport('woche', { projectId: 'p1', head, date: '2026-10-28', all: [] });
    if (w.type !== 'woche') throw new Error();
    w.data.days[1] = { ...w.data.days[1], count: 3, names: 'Max, Peter, Thomas', work: 'Schalung' };
    const fw = await reportPdf(w);
    if (!hasPoppler) return;
    const tt = text(ft.data, 'tag.pdf');
    expect(tt).toContain('BAUTAGESBERICHT');
    expect(tt).toContain('Bautagesbericht Nr. 1 (Fortsetzung)');
    expect(tt).toContain('PERSONALEINSATZ');
    expect(tt).toContain('Max Muster');
    expect(tt).not.toContain('Peter Muster'); // eingeteilt, aber nicht anwesend
    expect(tt).toContain('1 Person');
    expect(tt).toContain('LEISTUNGSFORTSCHRITT');
    expect(tt).toContain('Zeile 120');
    expect(tt).toContain('für den AG / die ÖBA');
    const tw = text(fw.data, 'woche.pdf');
    expect(tw).toContain('Bauwochenbericht Nr. 1');
    expect(tw).toContain('26.10.2026 – 01.11.2026');
    expect(tw).toContain('Dienstag');
    expect(tw).not.toContain('Montag'); // leerer Tag
    expect(tw).toContain('3 Personen');
  });
});
