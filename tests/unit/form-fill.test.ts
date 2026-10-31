import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeForm, type FormPage } from '../../src/lib/form-template';
import { dailyValues, fillForm, regieWeekValues } from '../../src/lib/form-fill';
import { emptyDaily, emptyRegie, workerRow } from '../../src/lib/reports';
import type { Report } from '../../src/lib/types';

const page = (name: string): FormPage => JSON.parse(new TextDecoder().decode(readFileSync(`tests/fixtures/forms/${name}.json`))) as FormPage;
const pdf = (name: string) => readFileSync(`tests/fixtures/forms/${name}.pdf`).buffer.slice(0) as ArrayBuffer;
/** Textprüfung nur, wenn poppler (pdftotext) installiert ist – auf dem Build-Server von GitHub fehlt es */
const hasPoppler = (() => {
  try {
    execFileSync('which', ['pdftotext'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
})();
/** Text des PDFs (leer ohne poppler – dann prüfen die Tests nur, dass das Ausfüllen durchläuft) */
const text = (data: Uint8Array, name = 'out') => {
  expect(data.length).toBeGreaterThan(10_000);
  try {
    mkdirSync('tests/output', { recursive: true });
    writeFileSync(`tests/output/formular-${name}.pdf`, data); // zur Sichtkontrolle
  } catch {
    /* optional */
  }
  if (!hasPoppler) return null;
  const dir = mkdtempSync(join(tmpdir(), 'form-'));
  const f = join(dir, 'out.pdf');
  writeFileSync(f, data);
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
};
const head = { project: 'Wohnanlage Sonnenhof', number: '2026-04', site: 'Wohnanlage Sonnenhof', address: 'Musterstraße 1, 4020 Linz', client: 'Muster GmbH', costCenter: '91092 – Tiefgarage', responsible: '' };

describe('Firmenformulare ausfüllen', () => {
  it('MST Bau-Tagesbericht: Kopf, Personalstand, Leistungen über mehrere Zeilen, Schlussabnahme', async () => {
    const layout = analyzeForm(page('mst-tagesbericht'), 'tag');
    const r: Report = {
      id: 'r1',
      projectId: 'p1',
      no: '7',
      date: '2026-10-28',
      status: 'draft',
      head,
      createdAt: 0,
      updatedAt: 0,
      type: 'tag',
      data: {
        ...emptyDaily(),
        from: '07:00',
        to: '16:30',
        staff: { projektleiter: 1, polier: 1, facharbeiter: 3 },
        work: 'Schalung Stützen Achse 3. Bewehrung Decke über EG verlegt, Betonage am Nachmittag. '.repeat(6),
        incidents: 'Betonlieferung 2 Std. verspätet.',
        notes: 'Regieleistung Kran abgestimmt.',
        acceptanceTime: '16:00',
        acceptanceBy: 'Ing. Huber',
        crew: [workerRow({ id: 'a', firstName: 'Max', lastName: 'Muster', role: 'Polier' }, { present: true, hours: 8 })],
      },
    };
    const out = text(await fillForm(pdf('mst-tagesbericht'), layout, dailyValues(r, layout, 'MST Muhr')), 'tagesbericht');
    if (out === null) return;
    expect(out).toContain('Bau-Tagesbericht Nr.');
    expect(out).toMatch(/Nr\.\s+7/);
    expect(out).toMatch(/am\s+28\.10\.\s+2026/); // Jahr stand schon im Formular
    expect(out).toContain('Wohnanlage Sonnenhof');
    expect(out).toMatch(/Kst\.\s+91092/);
    expect(out).toMatch(/Arbeitszeit von\s+07:00\s+bis\s+16:30/);
    expect(out).toMatch(/Bauleiter:\s+1\s+Vorarbeiter:\s+1\s+Facharbeiter:\s+3/); // PL zählt als Bauleiter, Polier als Vorarbeiter (Formular ohne eigene Felder)
    expect(out).toContain('Schalung Stützen Achse 3.');
    expect((out.match(/Bewehrung Decke/g) ?? []).length).toBeGreaterThanOrEqual(4); // über mehrere Zeilen verteilt
    expect(out).toContain('Betonlieferung 2 Std. verspätet.');
    expect(out).toMatch(/Schlussabnahme:\s+16:00\s+Uhr, von\s+Ing\. Huber/);
  });

  it('MST Regieliste als Wochenblatt: Stunden je Arbeiter in der Spalte des Wochentags', async () => {
    const layout = analyzeForm(page('mst-regieliste'), 'regie');
    const base = { projectId: 'p1', status: 'draft' as const, head, createdAt: 0, updatedAt: 0, type: 'regie' as const };
    const mon: Report = { ...base, id: 'a', no: '3', date: '2026-10-26', data: { ...emptyRegie(), work: 'Kernbohrungen', workers: [workerRow({ id: 'w1', firstName: 'Max', lastName: 'Muster', role: 'Polier' }, { hours: 8, ot50: 1 })], materials: [{ id: 'm', text: 'Bohrkrone 120', qty: 1, unit: 'Stk' }] } };
    const wed: Report = { ...base, id: 'b', no: '4', date: '2026-10-28', data: { ...emptyRegie(), work: 'Kernbohrungen', workers: [workerRow({ id: 'w1', firstName: 'Max', lastName: 'Muster', role: 'Polier' }, { hours: 6.5, travel: 1 }), workerRow({ id: 'w2', firstName: 'Peter', lastName: 'Pan' }, { hours: 4 })], travelCosts: '120 km' } };
    const values = regieWeekValues([mon, wed] as (Report & { type: 'regie' })[], '2026-10-26', layout, 'MST Muhr');
    expect(values.fields.week).toBe('44');
    expect(values.fields.no).toBe('3, 4');
    expect(values.rows).toHaveLength(2);
    expect(values.rows[0]).toMatchObject({ name: 'Max Muster', 'day:0:hours': '8', 'day:0:ot50': '1', 'day:2:hours': '6,5', 'day:2:travel': '1' });
    expect(values.rows[1]).toMatchObject({ name: 'Peter Pan', 'day:2:hours': '4' });
    const out = text(await fillForm(pdf('mst-regieliste'), layout, values), 'regieliste');
    if (out === null) return;
    expect(out).toContain('Max Muster');
    expect(out).toContain('Peter Pan');
    expect(out).toContain('Bohrkrone 120');
    expect(out).toContain('120 km');
    expect(out).toMatch(/\b44\b/);
  });
});
