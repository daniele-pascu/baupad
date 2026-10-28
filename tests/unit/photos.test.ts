import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayAndWeek, exifTakenAt, fileHash, groupBySite, groupByWeekAndDay, matchesPhoto, photoSiteKey, weekTitle } from '../../src/lib/photos';
import type { Photo } from '../../src/lib/types';
import { withExifDate } from './exif-fixture';

const P = (o: Partial<Photo> & { takenAt: number }): Photo => ({
  id: String(o.takenAt),
  companyId: null,
  projectId: 'p1',
  siteName: 'Neubau Musterstraße',
  siteNumber: '2026-04',
  siteAddress: 'Musterstraße 1',
  ...dayAndWeek(o.takenAt),
  takenFrom: 'exif',
  uploadedAt: o.takenAt + 3600_000,
  userName: 'Max',
  description: '',
  fileName: 'IMG_1.jpg',
  width: 2000,
  height: 1500,
  size: 400_000,
  hash: `h${o.takenAt}`,
  original: false,
  sync: 'local',
  deletedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...o,
});
const at = (s: string) => new Date(s).getTime();
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('Fotodokumentation', () => {
  it('Aufnahmetag und ISO-Kalenderwoche (Ortszeit, Jahreswechsel)', () => {
    expect(dayAndWeek(at('2026-10-28T09:15:00'))).toEqual({ day: '2026-10-28', week: '2026-10-26' });
    expect(dayAndWeek(at('2027-01-01T07:00:00'))).toEqual({ day: '2027-01-01', week: '2026-12-28' }); // Freitag → noch KW 53/2026
    expect(dayAndWeek(at('2026-01-01T07:00:00')).week).toBe('2025-12-29'); // Donnerstag → KW 1/2026 beginnt am 29.12.2025
    expect(weekTitle('2026-10-26')).toBe('KW 44 · 26.10. – 01.11.2026');
    expect(weekTitle('2026-12-28')).toBe('KW 53 · 28.12. – 03.01.2027');
  });

  it('Aufnahmezeitpunkt aus EXIF (DateTimeOriginal); ohne EXIF null; kein Absturz bei Fremddaten', () => {
    const jpeg = new Uint8Array(readFileSync('tests/fixtures/foto.jpg'));
    expect(exifTakenAt(ab(jpeg))).toBeNull(); // Fixture hat nur die Ausrichtung
    const withDate = withExifDate(jpeg, '2026:10:27 09:15:30');
    expect(exifTakenAt(ab(withDate))).toBe(new Date(2026, 9, 27, 9, 15, 30).getTime());
    expect(exifTakenAt(ab(new Uint8Array([1, 2, 3])))).toBeNull();
    expect(exifTakenAt(ab(withExifDate(jpeg, 'kein Datum')))).toBeNull();
  });

  it('Fingerabdruck (SHA-256) ist stabil und unterscheidet Dateien', async () => {
    const a = await fileHash(ab(new Uint8Array([1, 2, 3])));
    expect(a).toBe(await fileHash(ab(new Uint8Array([1, 2, 3]))));
    expect(a).toHaveLength(64);
    expect(a).not.toBe(await fileHash(ab(new Uint8Array([1, 2, 4]))));
  });

  it('Gruppierung Baustelle → Kalenderwoche → Tag (neueste zuerst, innerhalb des Tags nach Uhrzeit)', () => {
    const list = [
      P({ takenAt: at('2026-10-27T14:00:00') }),
      P({ takenAt: at('2026-10-27T08:00:00') }),
      P({ takenAt: at('2026-11-02T10:00:00') }),
      P({ takenAt: at('2026-10-26T10:00:00'), projectId: null, siteName: 'Halle 3', siteNumber: '', siteAddress: '' }),
    ];
    const sites = groupBySite(list);
    expect(sites.map((s) => [s.name, s.count, s.from, s.to, s.weeks.map((w) => w.week)])).toEqual([
      ['Neubau Musterstraße', 3, '2026-10-27', '2026-11-02', ['2026-11-02', '2026-10-26']],
      ['Halle 3', 1, '2026-10-26', '2026-10-26', ['2026-10-26']],
    ]);
    expect(photoSiteKey(list[3])).toBe('n:halle 3');
    const g = groupByWeekAndDay(list.filter((p) => p.projectId === 'p1'));
    expect(g.map((w) => [w.week, w.days.map((d) => [d.day, d.photos.map((p) => new Date(p.takenAt).getHours())])])).toEqual([
      ['2026-11-02', [['2026-11-02', [10]]]],
      ['2026-10-26', [['2026-10-27', [8, 14]]]],
    ]);
  });

  it('Suche: Baustelle, Nummer, Adresse, KW, Datum, Benutzer, Beschreibung', () => {
    const p = P({ takenAt: at('2026-10-28T09:00:00'), description: 'Riss Stütze B4', userName: 'Peter Bau' });
    for (const q of ['neubau', '2026-04', 'musterstraße 1', 'KW 44', 'kw44', '28.10.', '28.10.2026', '2026-10-28', 'peter', 'stütze']) expect(matchesPhoto(p, q)).toBe(true);
    for (const q of ['KW 45', '29.10.', 'Halle', 'Thomas']) expect(matchesPhoto(p, q)).toBe(false);
    expect(matchesPhoto(p, '')).toBe(true);
  });
});
