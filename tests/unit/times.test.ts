import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_TIMES } from '../../src/lib/crew';
import { pauseOf, easter, holidayOn, hoursOf, monthDays, parseHours, plannedHours, suggestDay, summarize, timesXlsx, type TimeDay } from '../../src/lib/times';
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
  it('Stunden aus von, bis und Pause', () => {
    expect(hoursOf('07:00', '16:00', 0.5)).toBe(8.5);
    expect(hoursOf('06:30', '15:15', 0.75)).toBe(8);
    expect(hoursOf('07:00', '12:00')).toBe(5);
    expect(hoursOf('', '12:00')).toBe(0);
  });
  it('Baustelle aus der Einteilung, Zeiten aus der Firmen-Arbeitszeit; zwei Baustellen geteilt', () => {
    expect(suggestDay('max', '2026-10-27', w, DEFAULT_WORK_TIMES, abs).lines).toEqual([{ projectId: 'p1', siteName: 'Parkring', from: '07:00', to: '16:00', pause: 0.5, pauseFrom: '12:00', pauseTo: '12:30', hours: 8.5 }]);
    expect(suggestDay('max', '2026-10-28', w, DEFAULT_WORK_TIMES, abs).lines).toEqual([
      { projectId: 'p1', siteName: 'Parkring', from: '07:00', to: '11:45', pause: 0.5, pauseFrom: '09:15', pauseTo: '09:45', hours: 4.25 },
      { projectId: null, siteName: 'Halle 3', from: '11:45', to: '16:00', pause: 0, hours: 4.25 },
    ]);
    // einmal eingetragene Zeiten des Arbeiters bleiben als Vorschlag
    expect(suggestDay('max', '2026-10-27', w, DEFAULT_WORK_TIMES, abs, { max: { from: '06:30', to: '15:30', pause: 1 } }).lines[0]).toMatchObject({ from: '06:30', to: '15:30', pause: 1, hours: 8 });
    expect(suggestDay('max', '2026-10-26', w, DEFAULT_WORK_TIMES, abs)).toMatchObject({ lines: [], holiday: 'Nationalfeiertag' });
    // Pause von–bis: Dauer automatisch
    expect(pauseOf('12:00', '12:45')).toBe(0.75);
    expect(pauseOf('12:30', '12:00')).toBe(0);
    expect(pauseOf('12:00', '')).toBe(0);
    expect(suggestDay('max', '2026-10-27', w, DEFAULT_WORK_TIMES, abs, { max: { from: '06:30', to: '15:30', pause: 0.75, pauseFrom: '11:30', pauseTo: '12:15' } }).lines[0]).toMatchObject({ pauseFrom: '11:30', pauseTo: '12:15', pause: 0.75, hours: 8.25 });
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
    const f = timesXlsx('2026-10', [worker('peter', 'Peter', 'Beispiel')], [day('peter', '2026-10-27', [{ projectId: 'p1', siteName: 'Parkring', from: '07:00', to: '16:00', pause: 0.5, hours: 8.5, travel: 1 }])], abs, DEFAULT_WORK_TIMES, 'Muster Bau');
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
    const sheet3 = strFromU8(files['xl/worksheets/sheet3.xml']);
    expect(sheet3).toContain('07:00');
    expect(sheet3).toContain('0:30');
  });
});

describe('Zeitaufzeichnung: Jahresdatei in der Firmenvorlage', () => {
  it('füllt Jahr, Name, Soll, Feiertage des Jahres, Zeiten, U/K, Pause nur wenn abweichend, Kommentar – Formeln bleiben', async () => {
    const { fillYearWorkbook, serial } = await import('../../src/lib/time-workbook');
    const { TIME_TEMPLATE_B64 } = await import('../../src/lib/time-template');
    const tpl = Uint8Array.from(atob(TIME_TEMPLATE_B64), (c) => c.charCodeAt(0));
    const w = { id: 'w1', firstName: 'Andrea', lastName: 'Pascu', active: true } as Worker;
    const data = fillYearWorkbook(tpl, {
      year: 2027,
      worker: w,
      times: DEFAULT_WORK_TIMES,
      absences: [{ id: 'a', workerId: 'w1', kind: 'krank', from: '2027-03-03', to: '2027-03-03', createdAt: 0 }],
      days: [
        day('w1', '2027-03-01', [{ projectId: null, siteName: 'Parkring', from: '07:00', to: '16:00', pause: 0.5, hours: 8.5, travel: 1 }]),
        day('w1', '2027-03-02', [{ projectId: null, siteName: 'Parkring', from: '07:00', to: '15:00', pause: 1, hours: 7 }]),
        day('w1', '2027-03-05', [{ projectId: null, siteName: 'Halle 3', from: '07:00', to: '12:00', pause: 0.5, hours: 4.5 }]),
        day('other', '2027-03-01', [{ projectId: null, siteName: 'X', from: '06:00', to: '07:00', pause: 0, hours: 1 }]),
      ],
    });
    const f = unzipSync(data);
    const start = strFromU8(f['xl/worksheets/sheet1.xml']);
    expect(start).toContain('<c r="C7" s="');
    expect(start).toMatch(/<c r="C7"[^>]*><v>2027<\/v>/);
    expect(start).toContain('Pascu Andrea');
    expect(start).toMatch(/<c r="C16"[^>]*><v>0\.3541666666666667<\/v>/); // 8:30 Soll
    const basis = strFromU8(f['xl/worksheets/sheet14.xml']);
    expect(basis).toMatch(new RegExp(`<c r="A7"[^>]*><v>${serial('2027-03-28')}</v>`)); // Ostersonntag 2027
    expect(basis).toMatch(new RegExp(`<c r="A8"[^>]*><v>${serial('2027-03-29')}</v>`));
    expect(basis).toContain('<f>A7-2</f>'); // Karfreitag bleibt Formel
    const march = strFromU8(f['xl/worksheets/sheet4.xml']);
    expect(march).toMatch(/<c r="C3"[^>]*><v>0\.2916666666666667<\/v>/); // 1.3. 07:00
    expect(march).toMatch(/<c r="D3"[^>]*><v>0\.6666666666666666<\/v>/); // 16:00
    expect(march).toContain('Parkring · Weg 1 h');
    expect(march).toMatch(/<c r="J3"[^>]*><f>/); // Pause wie Vorlage → Formel bleibt
    expect(march).toMatch(/<c r="J4"[^>]*><v>0\.041666666666666664<\/v>/); // 1 h Pause weicht ab → Wert
    expect(march).toMatch(/<c r="K5"[^>]*t="inlineStr"><is><t xml:space="preserve">K<\/t>/); // krank
    expect(march).toMatch(/<c r="J7"[^>]*><v>0\.020833333333333332<\/v>/); // Freitag: Vorlage 0:00, BauPad 0:30
    expect(march).not.toContain('>X<'); // anderer Arbeiter
    expect(march).toContain('<f>SUM(I3-J3,IF(OR(K3="U",K3="K"),B3,IF(K3="HU",B3/2)))</f>');
    expect(strFromU8(f['xl/workbook.xml'])).toContain('fullCalcOnLoad="1"');
    // Ergebnisse der Formeln sind mitgespeichert (wie Excel): Datum, Soll, Stunden, Summen – auch ohne Neuberechnung sichtbar
    expect(march).toMatch(new RegExp(`<c r="A3"[^>]*><f>[^<]*</f><v>${serial('2027-03-01')}</v>`));
    expect(march).toMatch(/<c r="B3"[^>]*><f>[^<]*<\/f><v>0\.354166666666666\d*<\/v>/); // Soll 8:30
    expect(Number(/<c r="I3"[^>]*><f>[^<]*<\/f><v>([^<]*)<\/v>/.exec(march)?.[1])).toBeCloseTo(0.375, 12); // 07:00–16:00 = 9:00
    expect(march).toMatch(/<c r="I34"[^>]*><f>[^<]*<\/f><v>0<\/v>/); // keine Urlaubstage im März
    expect(march).not.toMatch(/<f>[^<]*<\/f><\/c>/); // keine Formel ohne Ergebnis
    expect(strFromU8(f['xl/worksheets/sheet2.xml'])).toMatch(/<c r="I35"[^>]*><v>25<\/v>/); // Urlaubsanspruch Mo–Fr: 25 Tage
  });
});

describe('Zeitaufzeichnung: Jahresübertrag', () => {
  it('Resturlaub und Stunden zum Jahresende wie die Vorlage (mit LibreOffice nachgerechnet) – Jänner des Folgejahres übernimmt sie', async () => {
    const { fillYearWorkbook, yearEnd } = await import('../../src/lib/time-workbook');
    const { TIME_TEMPLATE_B64 } = await import('../../src/lib/time-template');
    const w = { id: 'w', firstName: 'Andrea', lastName: 'Pascu', active: true } as Worker;
    const d = (date: string, from: string, to: string, pause: number) => day('w', date, [{ projectId: null, siteName: 'X', from, to, pause, hours: 0 }]);
    const absences: Absence[] = [
      { id: 'a', workerId: 'w', kind: 'urlaub', from: '2025-08-04', to: '2025-08-08', createdAt: 0 },
      { id: 'b', workerId: 'w', kind: 'krank', from: '2025-09-01', to: '2025-09-02', createdAt: 0 },
    ];
    const days = [d('2025-03-03', '07:00', '17:00', 0.5), d('2025-03-04', '07:00', '15:00', 0.5), d('2025-06-06', '07:00', '12:00', 0.5), d('2025-11-12', '06:00', '18:00', 1)];
    // 25 Tage Anspruch − 5 U + 20 (Oktober laut Vorlage) = 40; Stunden: Dezember M36 der Vorlage
    const carry = yearEnd({ year: 2025, worker: w, times: DEFAULT_WORK_TIMES, absences, days });
    expect(carry).toEqual({ vacation: 40, hours: -2016 });
    const tpl = Uint8Array.from(atob(TIME_TEMPLATE_B64), (c) => c.charCodeAt(0));
    const jan = strFromU8(unzipSync(fillYearWorkbook(tpl, { year: 2026, worker: w, times: DEFAULT_WORK_TIMES, absences, days: [], carry }))['xl/worksheets/sheet2.xml']);
    expect(jan).toMatch(/<c r="I35"[^>]*><v>40<\/v>/);
    expect(jan).toMatch(/<c r="M35"[^>]*><v>-2016<\/v>/);
  });
});
