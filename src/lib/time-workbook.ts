import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { safeFileName, type ExportFile } from './aufmass';
import { addDays, workerName } from './crew';
import { calcWorkbook } from './xlsx-calc';
import { easter, holidayOn, monthDays, plannedHours, type TimeDay, type TimeLine } from './times';
import type { Absence, Worker, WorkTimes } from './types';

/**
 * Jahresdatei je Arbeiter in der Firmenvorlage „Arbeitszeiterfassung“ (Start, Januar–Dezember, Grundlagen):
 * alle Formeln, Farben, Feiertagsliste und Pausenregeln der Vorlage bleiben, BauPad trägt nur die Eingaben ein –
 * Jahr, Name, Soll je Wochentag, Feiertage des Jahres (Ostern & Co. neu berechnet), je Tag Beginn/Ende (bis zu drei
 * Blöcke), U/K und als Kommentar die Baustellen und Wegzeit. Excel rechnet beim Öffnen alles neu.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONTH_SHEETS = Array.from({ length: 12 }, (_, i) => `xl/worksheets/sheet${i + 2}.xml`);
const START = 'xl/worksheets/sheet1.xml';
const BASIS = 'xl/worksheets/sheet14.xml';

type CellValue = { n: number } | { s: string } | null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Zelle in einem Blatt setzen (Format bleibt); die Vorlage hat für alle Eingabezellen leere formatierte Zellen */
export function setCell(xml: string, ref: string, v: CellValue): string {
  const re = new RegExp(`<c r="${ref}"( s="\\d+")?( t="\\w+")?(?:/>|>(?:(?!</c>)[\\s\\S])*</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`Vorlage: Zelle ${ref} fehlt`);
  const s = m[1] ?? '';
  const cell = v === null ? `<c r="${ref}"${s}/>` : 'n' in v ? `<c r="${ref}"${s}><v>${v.n}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v.s)}</t></is></c>`;
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

/** Excel-Seriennummer eines Datums (Tage seit 30.12.1899) */
export const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** Uhrzeit als Tagesbruchteil in voller Genauigkeit – wie Excel „7:00“ speichert (sonst zeigt die Vorlage 10:44 statt 10:45) */
const dayFrac = (min: number) => min / 1440;

/** Soll je Wochentag (Mo–So) laut Firmen-Arbeitszeit, netto (über 6 h 0,5 h Pause) */
export function weeklySoll(times: WorkTimes): number[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const t = times[d];
    if (!t) return 0;
    const h = Math.max(0, minutes(t.to) - minutes(t.from)) / 60;
    return h > 6 ? h - 0.5 : h;
  });
}

/**
 * Pause, die die Vorlage selbst ansetzt (Tabelle „Pausen“: ab 4 h Soll 0:30, darunter keine);
 * in der Vorlage ist die Freitagspause fest auf 0:00 eingetragen.
 */
const templatePause = (weekday: number, sollH: number, workedH: number, code: string) => (code || workedH <= 0 || weekday === 4 ? 0 : sollH >= 4 ? 0.5 : 0);

/** Feiertage, die in der Vorlage als Datum stehen (Zeile → Datum des Jahres); bewegliche über Ostern */
function holidayDates(year: number): Record<string, string> {
  const e = easter(year);
  const d = (md: string) => `${year}-${md}`;
  return {
    A2: d('01-01'),
    A3: d('01-06'),
    A7: e,
    A8: addDays(e, 1),
    A9: d('05-01'),
    A10: addDays(e, 39),
    A13: addDays(e, 49),
    A14: addDays(e, 50),
    A15: addDays(e, 60),
    A16: d('08-15'),
    A18: d('10-26'),
    A19: d('11-01'),
    A24: d('12-08'),
    A28: d('12-24'),
    A29: d('12-25'),
    A30: d('12-26'),
    A31: d('12-31'),
  };
}
/** in der Vorlage als freie Tage markiert: gesetzliche Feiertage + 24. und 31.12. */
const freeInTemplate = (date: string) => !!holidayOn(date) || date.endsWith('-12-24') || date.endsWith('-12-31');

export interface YearFileInput {
  year: number;
  worker: Worker;
  times: WorkTimes;
  absences: Absence[];
  /** erfasste Tage des Arbeiters (beliebige Monate; verwendet wird das Jahr) */
  days: TimeDay[];
  /** Stand vom Jahresende des Vorjahres (Resturlaub, Stunden +/-); ohne Vorjahr: Urlaubsanspruch, 0 Stunden */
  carry?: YearCarry;
}

/** Übertrag ins nächste Jahr – wie die Vorlage im Dezember rechnet: „Stand Urlaub“ (I36) und „neuer Stand“ (M36) */
export interface YearCarry {
  vacation: number;
  hours: number;
}

/** Werte eines Tages, wie sie BauPad in die Vorlage schreibt (gemeinsam für Ausfüllen und Jahresübertrag) */
function dayValues(input: YearFileInput, soll: number[], date: string, rec: TimeDay | undefined) {
  const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
  const sollH = freeInTemplate(date) ? 0 : soll[weekday];
  const hits = input.absences.filter((a) => a.workerId === input.worker.id && date >= a.from && date <= a.to);
  const code = sollH > 0 && plannedHours(input.times, date) > 0 ? (hits.some((a) => a.kind === 'urlaub') ? 'U' : hits.length ? 'K' : '') : '';
  const lines = rec?.lines ?? [];
  const blocks = lines.slice(0, 3);
  const worked = blocks.reduce((s, b) => s + (span(b)[1] - span(b)[0]) / 60, 0);
  const pause = blocks.reduce((s, b) => s + (b.from ? (b.pause ?? 0) : 0), 0);
  return { weekday, sollH, code, lines, blocks, worked, pause };
}

const workdaysPerWeek = (soll: number[]) => soll.filter((h) => h > 0).length;
/** Urlaubsanspruch ohne Vorjahr: 5 Wochen × Arbeitstage je Woche (Vorlage: Mo–Do = 20 Tage) */
export const defaultVacation = (times: WorkTimes) => 5 * workdaysPerWeek(weeklySoll(times));

/**
 * Jahresende nachrechnen wie die Vorlage: je Monat Urlaub = Übertrag − U-Tage (Oktober + 20 laut Vorlage),
 * Stunden = Übertrag + Summe (Ist − Soll) je Tag; Ist = Stunden − Pause, bei U/K zählt das Soll.
 */
export function yearEnd(input: YearFileInput): YearCarry {
  const soll = weeklySoll(input.times);
  const byDate = new Map(input.days.filter((d) => d.workerId === input.worker.id && d.date.startsWith(`${input.year}-`)).map((d) => [d.date, d]));
  let vacation = input.carry?.vacation ?? defaultVacation(input.times);
  let hours = input.carry?.hours ?? 0;
  for (let m = 1; m <= 12; m++) {
    for (const date of monthDays(`${input.year}-${String(m).padStart(2, '0')}`)) {
      const v = dayValues(input, soll, date, byDate.get(date));
      if (v.code === 'U') vacation -= 1;
      const ist = v.worked - (v.blocks.length ? v.pause : 0) + (v.code ? v.sollH : 0);
      hours += ist - v.sollH;
    }
    if (m === 10) vacation += 20;
  }
  return { vacation, hours: Math.round(hours * 100) / 100 };
}

/** Name wie in der Vorlage: Nachname Vorname */
export const sheetName = (w: Pick<Worker, 'firstName' | 'lastName'>) => [w.lastName, w.firstName].filter((x) => x?.trim()).join(' ') || workerName(w);

const fmtH = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
/** Beginn/Ende einer Zeile; ältere Einträge nur mit Stunden: ab 07:00 */
const span = (l: TimeLine): [number, number] => (l.from && l.to ? [minutes(l.from), minutes(l.to)] : [420, 420 + Math.round((l.hours + (l.pause ?? 0)) * 60)]);

/** Jahresdatei füllen (Vorlage als .xlsx-Bytes) */
export function fillYearWorkbook(template: Uint8Array, input: YearFileInput): Uint8Array {
  const files = unzipSync(template);
  const read = (p: string) => strFromU8(files[p]);
  const { year, worker, times } = input;
  const soll = weeklySoll(times);
  const name = sheetName(worker);

  // Start: Jahr, Name, Soll je Wochentag (Mitarbeiterliste)
  let start = read(START);
  start = setCell(start, 'C7', { n: year });
  start = setCell(start, 'E7', { s: name });
  start = setCell(start, 'B16', { s: name });
  'CDEFGHI'.split('').forEach((col, i) => (start = setCell(start, `${col}16`, { n: dayFrac(soll[i] * 60) })));
  files[START] = strToU8(start);

  // Grundlagen: Feiertage des Jahres
  let basis = read(BASIS);
  for (const [ref, iso] of Object.entries(holidayDates(year))) basis = setCell(basis, ref, { n: serial(iso) });
  files[BASIS] = strToU8(basis);

  // Jänner: Übertrag vom Vorjahr (Resturlaub und Stunden) – ohne Vorjahr Urlaubsanspruch, 0 Stunden
  let jan = setCell(read(MONTH_SHEETS[0]), 'I35', { n: input.carry?.vacation ?? defaultVacation(times) });
  if (input.carry?.hours) jan = setCell(jan, 'M35', { n: input.carry.hours });
  files[MONTH_SHEETS[0]] = strToU8(jan);

  // Monate: je Tag Beginn/Ende (bis zu drei Blöcke), U/K, Pause nur wenn abweichend, Kommentar
  const byDate = new Map(input.days.filter((d) => d.workerId === worker.id && d.date.startsWith(`${year}-`)).map((d) => [d.date, d]));
  MONTH_SHEETS.forEach((path, mi) => {
    let xml = read(path);
    const month = `${year}-${String(mi + 1).padStart(2, '0')}`;
    for (const date of monthDays(month)) {
      const row = Number(date.slice(8)) + 2;
      const { weekday, code, lines, blocks, worked, pause } = dayValues(input, soll, date, byDate.get(date));
      ['C', 'E', 'G'].forEach((col, i) => {
        const end = String.fromCharCode(col.charCodeAt(0) + 1);
        const b = blocks[i];
        if (!b) return;
        const [f, t] = span(b);
        xml = setCell(xml, `${col}${row}`, { n: dayFrac(f) });
        xml = setCell(xml, `${end}${row}`, { n: dayFrac(t) });
      });
      if (code) xml = setCell(xml, `K${row}`, { s: code });
      // Pause: die Vorlage rechnet sie selbst; nur wenn BauPad etwas anderes erfasst hat, steht der Wert fest drin
      if (blocks.length && Math.abs(pause - templatePause(weekday, soll[weekday], worked, code)) > 1e-6) xml = setCell(xml, `J${row}`, { n: dayFrac(pause * 60) });
      const notes = [
        [...new Set(lines.map((l) => l.siteName).filter(Boolean))].join('; '),
        lines.some((l) => l.travel) ? `Weg ${fmtH(lines.reduce((s, l) => s + (l.travel ?? 0), 0))} h` : '',
        lines.length > 3 ? `+ ${lines.slice(3).map((l) => `${l.siteName} ${l.from ?? ''}–${l.to ?? ''}`).join(', ')}` : '',
      ].filter(Boolean);
      if (notes.length) xml = setCell(xml, `P${row}`, { s: notes.join(' · ') });
    }
    files[path] = strToU8(xml);
  });

  // Titel in den Dateieigenschaften
  if (files['docProps/core.xml']) files['docProps/core.xml'] = strToU8(read('docProps/core.xml').replace(/<dc:title>[^<]*<\/dc:title>/, '').replace('</cp:coreProperties>', `<dc:title>${esc(`Arbeitszeiterfassung ${year} – ${name}`)}</dc:title></cp:coreProperties>`));
  // Ergebnisse aller Formeln mitspeichern (wie Excel) – sonst zeigen Vorschauen und die geschützte Ansicht leere Felder
  calcWorkbook(files);
  return zipSync(files, { level: 6 });
}

let templateBytes: Uint8Array | null = null;
async function template(): Promise<Uint8Array> {
  if (templateBytes) return templateBytes;
  const { TIME_TEMPLATE_B64 } = await import('./time-template');
  const bin = atob(TIME_TEMPLATE_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  templateBytes = out;
  return out;
}

/** Dateiname: Zeitaufzeichnung_2026_Pascu_Andrea (mit Monat für gespeicherte Monatsstände) */
export const yearFileName = (year: number, w: Pick<Worker, 'firstName' | 'lastName'>, month?: string) => `${safeFileName('Zeitaufzeichnung', month ?? String(year), sheetName(w))}.xlsx`;

export async function timeYearFile(input: YearFileInput, month?: string): Promise<ExportFile> {
  return { name: yearFileName(input.year, input.worker, month), data: fillYearWorkbook(await template(), input), mimeType: XLSX_MIME };
}
