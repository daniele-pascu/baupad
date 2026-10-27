import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSite, assign, DEFAULT_WORK_TIMES, emptyWeek, setVacation, updateSite } from '../../src/lib/crew';
import { crewDayPdf, crewWeekPdf } from '../../src/lib/crew-pdf';
import type { Worker } from '../../src/lib/types';

const W = (id: string, firstName: string, lastName: string, extra: Partial<Worker> = {}): Worker => ({ id, firstName, lastName, active: true, createdAt: 0, updatedAt: 0, ...extra });
const workers = [W('a', 'Max', 'Muster', { role: 'Polier', phone: '0664 123' }), W('b', 'Łukasz', 'Wójcik'), W('c', 'Ivan', 'Ćosić'), W('d', 'Stefan', 'Holz')];
const dir = mkdtempSync(join(tmpdir(), 'crew-pdf-'));
const text = (data: Uint8Array, name: string) => {
  const f = join(dir, name);
  writeFileSync(f, data);
  return { text: execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }), info: execFileSync('pdfinfo', [f], { encoding: 'utf8' }) };
};

function week(sites = 2) {
  let w = emptyWeek('2026-10-26');
  for (let i = 0; i < sites; i++) {
    const r = addSite(w, { projectId: null, name: i === 0 ? 'Neubau Musterstraße' : `Baustelle ${i + 1}`, number: i === 0 ? '2026-04' : '', address: i === 0 ? 'Musterstraße 1' : '' });
    w = assign(r.week, r.site.id, [0, 1, 2, 3, 4], i === 0 ? ['a', 'b'] : ['c']);
  }
  w = updateSite(w, w.sites[0].id, { note: 'Kran ab Mittwoch' });
  return setVacation(w, 'd', [0, 1, 2, 3, 4], true);
}

describe('PDF der Arbeitereinteilung', () => {
  it('Wochenplan A4 quer: KW, Zeitraum, Firma, Baustellen mit Tagen, Bemerkung, Urlaub; Sonderzeichen ohne Absturz', async () => {
    const f = await crewWeekPdf(week(), workers, DEFAULT_WORK_TIMES, { company: 'Muster Bau GmbH' });
    expect(f.name).toBe('Arbeitereinteilung_KW44_2026.pdf');
    const { text: t, info } = text(f.data, 'woche.pdf');
    expect(info).toMatch(/Page size:\s+841\.89 x 595\.28/); // A4 quer
    for (const s of ['Arbeitereinteilung KW 44', '26.10. – 30.10.2026', 'Muster Bau GmbH', 'Neubau Musterstraße', '2026-04 · Musterstraße 1', 'Mo 26.10.', 'Fr 30.10.', '07:00–16:00', 'Max Muster', 'Kran ab Mittwoch', 'Urlaub:', 'Stefan Holz (Mo–Fr)'])
      expect(t).toContain(s);
    expect(t).toContain('Lukasz Wójcik'); // ł → l, ó bleibt
    expect(t).toContain('Ivan Cosic');
  });

  it('viele Baustellen → mehrere Seiten statt kleiner Schrift', async () => {
    const f = await crewWeekPdf(week(14), workers, DEFAULT_WORK_TIMES);
    const { text: t, info } = text(f.data, 'viele.pdf');
    expect(Number(/Pages:\s+(\d+)/.exec(info)![1])).toBeGreaterThan(1);
    expect(t).toContain('Baustelle 14');
    expect(t).toContain('(Fortsetzung)');
  });

  it('Tagesliste einer Baustelle: A4 hoch, Datum, Arbeiter mit Tätigkeit und Telefon', async () => {
    const w = week();
    const f = await crewDayPdf(w, w.sites[0].id, 0, workers, DEFAULT_WORK_TIMES, { company: 'Muster Bau GmbH' });
    const { text: t, info } = text(f.data, 'tag.pdf');
    expect(info).toMatch(/Page size:\s+595\.28 x 841\.89/);
    for (const s of ['Tagesliste Montag, 26.10.2026', 'Neubau Musterstraße', 'Arbeitszeit: 07:00–16:00 Uhr', 'Max Muster', 'Polier', '0664 123', '2 Arbeiter eingeteilt']) expect(t).toContain(s);
  });
});
