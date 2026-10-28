import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_OPTIONS, photoPdf } from '../../src/lib/photo-pdf';
import { dayAndWeek } from '../../src/lib/photos';
import type { Photo } from '../../src/lib/types';

const jpeg = new Uint8Array(readFileSync('tests/fixtures/foto.jpg'));
const at = (s: string) => new Date(s).getTime();
const P = (takenAt: number, description = ''): Photo => ({
  id: String(takenAt),
  companyId: null,
  projectId: 'p1',
  siteName: 'Neubau Musterstraße',
  siteNumber: '2026-04',
  siteAddress: 'Musterstraße 1',
  takenAt,
  ...dayAndWeek(takenAt),
  takenFrom: 'exif',
  uploadedAt: takenAt,
  userName: 'Max',
  description,
  fileName: 'IMG.jpg',
  width: 2000,
  height: 1500,
  size: 1,
  hash: `h${takenAt}`,
  original: false,
  sync: 'local',
  deletedAt: null,
  createdAt: 0,
  updatedAt: 0,
});
const site = { name: 'Neubau Musterstraße', number: '2026-04', address: 'Musterstraße 1' };
const photos = [P(at('2026-10-27T09:15:00'), 'Riss Stütze B4'), P(at('2026-10-27T14:40:00')), P(at('2026-11-02T08:05:00'))];
const load = async () => jpeg;

describe('Foto-PDF', () => {
  it('je KW eine Seite (4 je Seite): KW 44 mit zwei Fotos, KW 45 mit einem; älteste zuerst', async () => {
    const f = await photoPdf(site, photos, load, { ...DEFAULT_PDF_OPTIONS, company: 'Muster Bau GmbH', logo: null });
    expect(f.name).toMatch(/^Fotos_Neubau_Musterstrasse_\d{4}-\d{2}-\d{2}\.pdf$/);
    const doc = await PDFDocument.load(f.data);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
  });
  it('ohne Gruppierung passen 3 Fotos bei 4 je Seite auf eine Seite; 1 je Seite quer ergibt 3 Seiten', async () => {
    const a = await photoPdf(site, photos, load, { ...DEFAULT_PDF_OPTIONS, company: '', logo: null, groupBy: 'none' });
    expect((await PDFDocument.load(a.data)).getPageCount()).toBe(1);
    const b = await photoPdf(site, photos, load, { ...DEFAULT_PDF_OPTIONS, company: '', logo: null, groupBy: 'none', perPage: 1, landscape: true, logoRight: false });
    const doc = await PDFDocument.load(b.data);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(841.89, 1);
  });
  it('ohne Fotos eine Seite mit Hinweis; fehlendes Bild bricht nicht ab', async () => {
    const a = await photoPdf(site, [], load, { ...DEFAULT_PDF_OPTIONS, company: '', logo: null });
    expect((await PDFDocument.load(a.data)).getPageCount()).toBe(1);
    const b = await photoPdf(site, photos.slice(0, 1), async () => null, { ...DEFAULT_PDF_OPTIONS, company: '', logo: null });
    expect((await PDFDocument.load(b.data)).getPageCount()).toBe(1);
  });
});
