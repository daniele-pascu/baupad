import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_TIMES } from '../../src/lib/crew';
import { easter, holidayOn, monthDays, parseHours, plannedHours, suggestDay, summarize, timesXlsx, type TimeDay } from '../../src/lib/times';
import type { Absence, WeekPlan, Worker } from '../../src/lib/types';

const worker = (id: string, firstName: string, lastName = ''): Worker => ({ id, firstName, lastName, active: true }) as Worker;
const week = (id: string, sites: { name: string; projectId?: string; days: string[][] }[]): WeekPlan => ({ id, sites: sites.map((s, i) => ({ id: `s${i}`, projectId: s.projectId ?? null, name: s.name, days: s.days })), vacation: [], createdAt: 0, updatedAt: 0 }) as WeekPlan;
const day = (workerId: string, date: string, lines: TimeDay['lines']): TimeDay => ({ id: `${workerId}|${date}`, workerId, date, month: date.slice(0, 7), lines, updatedAt: 0, updatedBy: 'Polier' });

describe('Zeitaufzeichnung: Kalender', () => {
  it('Ostern und österreichische Feiertage', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
    expect(holidayOn('2026-04-06')).toBe('Ostermontag');
    expect(holidayOn('2026-05-14')).toBe('Christi Himmelfahrt');
    expect(holidayOn('2026-05-25')).toBe('Pfingstmontag');
    expect(holidayOn('2026-06-04')).toBe('Fronleichnam');
    expect(holidayOn('2026-10-26')).toBe('Nationalfeiertag');
    expect(holidayOn('2026-12-08')).toBe('Mariä Empfängnis');
    expect(holidayOn('2026-10-27')).toBeNull();
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02')).toHaveLength(29);
  });
  it('Sollstunden: Firmen-Arbeitszeit, über 6 Stunden 0,5 Stunden Pause, Feiertag und Wochenende 0', () => {
    expect(plannedHours(DEFAULT_WORK_TIMES, '2026-10-28')).toBe(8.5); // Mi 07:00–16:00
    expect(plannedHours(DEFAULT_WORK_TIMES, '2026-10-31')).toBe(0); // Sa
    expect(plannedHours(DEFAULT_WORK_TIMES, '2026-10-26')).toBe(0); // Nationalfeiertag
    const short = DEFAULT_WORK_TIMES.map((t, i) => (i === 4 ? { from: '07:00', to: '12:00' } : t));
    expect(plannedHours(short, '2026-10-30')).toBe(5); // Fr kurz, keine Pause
  });
  it('Stunden eingeben: Komma oder Punkt, leer, ungültig', () => {
    expect(parseHours('8,5')).toBe(8.5);
    expect(parseHours('7.25')).toBe(7.25);
    expect(parseHours('')).toBeNull();
    expect(parseHours('abc')).toBeNull();
    expect(parseHours('25')).toBeNull();
  });
});

describe('Zeitaufzeichnung: Vorschlag und Summen', () => {
  const w = week('2026-10-26', [
    { name: 'Parkring', projectId: 'p1', days: [['max'], ['max', 'peter'], ['max'], ['max'], ['max'], [], []] },
    { name: 'Halle 3', days: [[], [], ['max'], [], [], [], []] },
  ]);
  const abs: Absence[] = [{ id: 'a', workerId: 'peter', kind: 'urlaub', from: '2026-10-29', to: '2026-10-30', createdAt: 0 }];
  it('Baustelle aus der Einteilung, Stunden aus der Firmen-Arbeitszeit; zwei Baustellen geteilt', () => {
    expect(suggestDay('max', '2026-10-27', w, DEFAULT_WORK_TIMES, abs).lines).toEqual([{ projectId: 'p1', siteName: 'Parkring', hours: 8.5 }]);
    expect(suggestDay('max', '2026-10-28', w, DEFAULT_WORK_TIMES, abs).lines).toEqual([
      { projectId: 'p1', siteName: 'Parkring', hours: 4.25 },
      { projectId: null, siteName: 'Halle 3', hours: 4.25 },
    ]);
    expect(suggestDay('max', '2026-10-26', w, DEFAULT_WORK_TIMES, abs)).toMatchObject({ lines: [], holiday: 'Nationalfeiertag' });
    expect(suggestDay('peter', '2026-10-29', w, DEFAULT_WORK_TIMES, abs)).toMatchObject({ lines: [], absence: 'urlaub' });
    expect(suggestDay('peter', '2026-10-28', w, DEFAULT_WORK_TIMES, abs).lines).toEqual([]); // nicht eingeteilt
  });
  it('Summen: nur erfasste Stunden, offene Werktage bis heute, Soll ohne Feiertage, Urlaubstage', () => {
    const days = new Map([
      ['2026-10-27', day('peter', '2026-10-27', [{ projectId: 'p1', siteName: 'Parkring', hours: 8.5, travel: 1 }])],
      ['2026-10-28', day('peter', '2026-10-28', [{ projectId: 'p1', siteName: 'Parkring', hours: 4 }, { projectId: null, siteName: 'Halle 3', hours: 4.5 }])],
    ]);
    const s = summarize('2026-10', days, DEFAULT_WORK_TIMES, abs, 'peter', '2026-10-30');
    expect(s.hours).toBe(17);
    expect(s.travel).toBe(1);
    expect(s.target).toBe(21 * 8.5); // 22 Werktage im Oktober 2026, davon Nationalfeiertag
    expect(s.vacation).toBe(2);
    expect(s.open).not.toContain('2026-10-29'); // Urlaub ist nicht offen
    expect(s.open).toContain('2026-10-01');
    expect(s.open).not.toContain('2026-10-26'); // Feiertag
    expect(s.bySite).toEqual([
      { name: 'Parkring', hours: 12.5 },
      { name: 'Halle 3', hours: 4.5 },
    ]);
  });
  it('Excel: drei Blätter, Stunden je Tag, U für Urlaub, F für Feiertag', () => {
    const f = timesXlsx('2026-10', [worker('peter', 'Peter', 'Beispiel')], [day('peter', '2026-10-27', [{ projectId: 'p1', siteName: 'Parkring', hours: 8.5, travel: 1 }])], abs, DEFAULT_WORK_TIMES, 'Muster Bau');
    expect(f.name).toBe('Zeitaufzeichnung_2026-10_Muster_Bau.xlsx');
    const files = unzipSync(f.data);
    const wb = strFromU8(files['xl/workbook.xml']);
    expect(wb).toContain('name="Monat"');
    expect(wb).toContain('name="Je Baustelle"');
    expect(wb).toContain('name="Einzeln"');
    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']);
    const sheet2 = strFromU8(files['xl/worksheets/sheet2.xml']);
    expect(sheet1).toContain('Peter Beispiel');
    expect(sheet1).toContain('<v>8.5</v>');
    expect(sheet1).toContain('>U<');
    expect(sheet1).toContain('>F<');
    expect(sheet2).toContain('Parkring');
  });
});
