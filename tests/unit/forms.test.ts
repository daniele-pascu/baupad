import { describe, expect, it } from 'vitest';
import { analyzeForm } from '../../src/lib/form-template';
import { workTimeFor, displayValue, duplicateNos, parseNoRange, lineBoxes, wrapToLines, fieldsFromDetection, fits, isoWeek, isoWeekLabel, lineCapacity, nextFormNo, prefill, qualificationsFor, readingOrder, withQualifications, wrapText, type CustomField, type FormEntry } from '../../src/lib/forms';
import tagesbericht from '../fixtures/forms/mst-tagesbericht.json';

/** Näherung für Helvetica: 0,5 × Schriftgröße je Zeichen */
const measure = (s: string, size: number) => s.length * size * 0.5;
const field = (p: Partial<CustomField>): CustomField => ({ id: p.id ?? 'f', name: p.name ?? 'Feld', type: p.type ?? 'text', box: p.box ?? { x: 0, y: 0, w: 100, h: 12 }, ...p });
const entry = (p: Partial<FormEntry>): FormEntry => ({ id: p.id ?? 'e', templateId: 't1', templateName: 'Regieliste', templateVersion: 1, fileId: 't1', layout: { width: 595, height: 842, fields: [] }, projectId: 'p1', siteName: 'Halle', no: '1', date: '2026-10-28', values: {}, status: 'draft', createdBy: '', createdAt: 0, updatedAt: 0, ...p });

describe('Firmenformulare: Nummerierung durchgehend je Vorlage', () => {
  it('nächste Nummer = höchste + 1 je Vorlage, über alle Projekte; Lücken bleiben', () => {
    const all = [entry({ no: '1' }), entry({ id: 'b', no: '7' }), entry({ id: 'c', no: '3', templateId: 't2' }), entry({ id: 'd', no: '20', projectId: 'p2' })];
    expect(nextFormNo(all, 't1')).toBe('21');
    expect(nextFormNo(all, 't2')).toBe('4');
    expect(nextFormNo(all, 't9')).toBe('1');
  });
  it('doppelte Nummern (zwei Geräte) werden erkannt – je Vorlage, auch projektübergreifend', () => {
    const dup = duplicateNos([entry({ id: 'a', no: '8' }), entry({ id: 'b', no: '8' }), entry({ id: 'c', no: '9' }), entry({ id: 'd', no: '8', projectId: 'p2' })]);
    expect([...dup].sort()).toEqual(['a', 'b', 'd']);
  });
  it('Nummernbereich zum Drucken: „3-20“, „3–5, 8“; ungültig → null', () => {
    expect([...parseNoRange('3-6')!]).toEqual([3, 4, 5, 6]);
    expect([...parseNoRange('3–5, 8')!]).toEqual([3, 4, 5, 8]);
    expect([...parseNoRange('20-18')!]).toEqual([18, 19, 20]);
    expect(parseNoRange('abc')).toBeNull();
    expect(parseNoRange('')).toBeNull();
  });
  it('Wochentag aus dem Datum (Feld „Wochentag“), auch als Vorschlag beim Anlegen', () => {
    const f = field({ id: 'w', type: 'weekday' });
    expect(displayValue(f, '2026-11-04')).toBe('Mittwoch');
    expect(prefill([f, field({ id: 'k', type: 'week' })], { date: '2026-11-05' })).toEqual({ w: 'Donnerstag', k: '45' });
  });
});

describe('Firmenformulare: Felder', () => {
  it('Leserichtung: Zeilen von oben nach unten, darin von links nach rechts', () => {
    const order = readingOrder([field({ id: 'c', box: { x: 300, y: 100, w: 50, h: 10 } }), field({ id: 'a', box: { x: 10, y: 20, w: 50, h: 10 } }), field({ id: 'b', box: { x: 200, y: 23, w: 50, h: 10 } }), field({ id: 'd', box: { x: 20, y: 103, w: 50, h: 10 } })]);
    expect(order.map((f) => f.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('mehrzeilig: Zeilen aus der Kastenhöhe, Enter zählt als Zeile, Überlauf wird gemeldet', () => {
    const f = field({ type: 'multiline', box: { x: 0, y: 0, w: 200, h: 48 } }); // 9 pt → 11,9 pt je Zeile → 4 Zeilen
    expect(lineCapacity(f)).toBe(4);
    expect(lineCapacity(field({ type: 'multiline', box: { x: 0, y: 0, w: 200, h: 48 }, lines: 6 }))).toBe(6);
    expect(wrapText('eins\nzwei\n\nvier', 200, 9, measure)).toEqual(['eins', 'zwei', '', 'vier']);
    expect(fits(f, 'a\nb\nc\nd', measure)).toEqual({ ok: true, lines: 4, capacity: 4 });
    expect(fits(f, 'a\nb\nc\nd\ne', measure).ok).toBe(false);
    // Wortumbruch: 200 pt breit, 9 pt Schrift → ca. 44 Zeichen je Zeile
    const long = 'Dieser Satz ist lang genug, dass er sicher umbrochen werden muss, weil der Kasten schmal ist.';
    expect(wrapText(long, 200, 9, measure).length).toBe(3);
  });
  it('einzeilig: zu langer Text wird gemeldet', () => {
    expect(fits(field({ box: { x: 0, y: 0, w: 30, h: 12 } }), 'kurz', measure).ok).toBe(true);
    expect(fits(field({ box: { x: 0, y: 0, w: 30, h: 12 } }), 'viel zu langer Text für den Kasten', measure).ok).toBe(false);
  });
  it('Anzeige: Datum, Betrag, Kontrollkästchen', () => {
    expect(displayValue(field({ type: 'date' }), '2026-10-28')).toBe('28.10.2026');
    expect(displayValue(field({ type: 'date', dateFormat: 'dd.MM.' }), '2026-10-28')).toBe('28.10.');
    expect(displayValue(field({ type: 'amount' }), '1250')).toBe('1.250,00');
    expect(displayValue(field({ type: 'amount' }), '12,5')).toBe('12,50');
    expect(displayValue(field({ type: 'checkbox' }), 'x')).toBe('X');
    expect(displayValue(field({ type: 'checkbox' }), '')).toBe('');
  });
});

describe('Firmenformulare: Kalenderwoche und Übernahme', () => {
  it('ISO-Kalenderwoche mit Jahreswechsel', () => {
    expect(isoWeek('2026-10-28')).toEqual({ week: 44, year: 2026 });
    expect(isoWeek('2026-12-31')).toEqual({ week: 53, year: 2026 }); // Donnerstag → KW 53
    expect(isoWeek('2027-01-01')).toEqual({ week: 53, year: 2026 }); // gehört noch zur KW 53/2026
    expect(isoWeek('2027-01-04')).toEqual({ week: 1, year: 2027 });
    expect(isoWeek('2024-12-30')).toEqual({ week: 1, year: 2025 });
    expect(isoWeekLabel('2027-01-01')).toBe('KW 53/2026');
  });
  it('übernimmt nur, wo ein Feld dafür da ist; fehlende Angaben bleiben leer', () => {
    const fields = [
      field({ id: 'site', type: 'project', source: 'name' }),
      field({ id: 'nr', type: 'project', source: 'number' }),
      field({ id: 'client', type: 'project', source: 'client' }),
      field({ id: 'date', type: 'date' }),
      field({ id: 'kw', type: 'week' }),
      field({ id: 'who', type: 'person' }),
      field({ id: 'firma', type: 'company' }),
      field({ id: 'no', type: 'no' }),
      field({ id: 'text', type: 'multiline' }),
    ];
    const v = prefill(fields, { project: { name: 'Halle 3', number: '2026-04' }, date: '2026-12-31', people: ['Max Muster', 'Peter Beispiel'], company: 'Muster Bau', no: '5' });
    expect(v).toEqual({ site: 'Halle 3', nr: '2026-04', client: '', date: '2026-12-31', kw: '53', who: 'Max Muster, Peter Beispiel', firma: 'Muster Bau', no: '5' });
    expect(v.text).toBeUndefined();
    // ohne Projekt und ohne Einteilung: Felder bleiben unberührt
    expect(prefill(fields, { date: '2026-10-28' }, { who: 'Hans' })).toEqual({ who: 'Hans', date: '2026-10-28', kw: '44' });
  });
});

describe('Firmenformulare: Vorschlag aus der Erkennung', () => {
  it('Bautagesbericht: Namen aus den Beschriftungen, Typen passend, mehrzeilige Kästen zusammengefasst', () => {
    const fields = fieldsFromDetection(analyzeForm(tagesbericht as never, 'tag'));
    const by = (n: string) => fields.find((f) => f.name === n);
    expect(fields.length).toBe(14);
    expect(by('Bauvorhaben')).toMatchObject({ type: 'project', source: 'name' });
    expect(by('Kst')).toMatchObject({ type: 'project', source: 'costCenter' });
    expect(by('Bau-Tagesbericht Nr')).toMatchObject({ type: 'no' });
    expect(by('Leistungsbeschreibung')?.type).toBe('multiline');
    expect(by('Leistungsbeschreibung')!.lines!).toBeGreaterThan(1);
    expect(by('Facharbeiter')?.type).toBe('number');
    expect(fields.every((f) => f.name.trim() && f.box.w > 0 && f.box.h > 0)).toBe(true);
  });
});

describe('Firmenformulare: Zeilen mit eigenem Beginn/Ende', () => {
  it('Einzug je Zeile verschiebt Anfang bzw. Ende; Umbruch nutzt die Breite jeder Zeile', () => {
    const f = field({ type: 'multiline', lines: 3, pitch: 20, fontSize: 10, box: { x: 100, y: 50, w: 200, h: 51 }, lineInsets: [{ left: 60, right: 0 }, { left: 0, right: 0 }, { left: 0, right: 100 }] });
    const b = lineBoxes(f);
    expect(b.map((x) => [x.x, x.w, x.y])).toEqual([
      [160, 140, 50],
      [100, 200, 70],
      [100, 100, 90],
    ]);
    // 10 pt Schrift, Näherung 5 pt je Zeichen: erste Zeile fasst 27 Zeichen, zweite 39
    const lines = wrapToLines(f, 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd', measure);
    expect(lines[0]).toBe('aaaaaaaaaa bbbbbbbbbb');
    expect(lines[1]).toBe('cccccccccc dddddddddd');
  });
});

describe('Firmenformulare: Uhrzeit aus den Arbeitszeiten der Firma', () => {
  const wt = [{ from: '07:00', to: '16:00' }, { from: '07:00', to: '16:00' }, { from: '07:00', to: '16:00' }, { from: '07:00', to: '16:00' }, { from: '07:00', to: '12:30' }, null, null];
  it('Beginn/Ende je Wochentag; freier Tag → kein Vorschlag', () => {
    expect(workTimeFor({ timeOf: 'from' }, { date: '2026-11-06', workTimes: wt })).toBe('07:00'); // Freitag
    expect(workTimeFor({ timeOf: 'to' }, { date: '2026-11-06', workTimes: wt })).toBe('12:30');
    expect(workTimeFor({ timeOf: 'to' }, { date: '2026-11-07', workTimes: wt })).toBeUndefined(); // Samstag frei
    expect(prefill([field({ id: 'b', type: 'time', timeOf: 'from' }), field({ id: 'e', type: 'time', timeOf: 'to' })], { date: '2026-11-02', workTimes: wt })).toEqual({ b: '07:00', e: '16:00' });
  });
});

describe('Qualifikation übernehmen, wenn das Formular danach fragt', () => {
  const f = (id: string, type: CustomField['type'], name: string) => ({ id, type, name, box: { x: 0, y: 0, w: 100, h: 12 } }) as unknown as CustomField;
  const fields = [f('p', 'person', 'Mitarbeiter'), f('q', 'text', 'Qualifikation'), f('n', 'text', 'Bemerkung')];

  it('aus dem Kürzel vor dem Namen, in derselben Reihenfolge', () => {
    expect(qualificationsFor('PO Muster Max, VA Berg Anna, Gast Hans', false)).toBe('Polier, Vorarbeiter');
    expect(qualificationsFor('FA Holz Stefan\nHA Stein Thomas', true)).toBe('Facharbeiter\nHilfsarbeiter');
  });

  it('beim Anlegen aus der Einteilung und bei Änderung der Personen – eigene Eingabe bleibt', () => {
    const v = prefill(fields, { people: ['PO Muster Max', 'FA Holz Stefan'] });
    expect(v).toMatchObject({ p: 'PO Muster Max, FA Holz Stefan', q: 'Polier, Facharbeiter' });
    expect(v.n).toBeUndefined();
    const changed = withQualifications(fields, { ...v, p: 'VA Berg Anna' }, v);
    expect(changed.q).toBe('Vorarbeiter');
    const own = withQualifications(fields, { ...v, q: 'Maurer', p: 'VA Berg Anna' }, { ...v, q: 'Maurer' });
    expect(own.q).toBe('Maurer');
  });
});
