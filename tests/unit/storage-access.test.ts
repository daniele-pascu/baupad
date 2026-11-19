import { describe, expect, it } from 'vitest';
import { accessOf, canProject, fileAllowed, fileKeyOwner, hasTool, keepPrices, photoAllowed, stripPrices, visiblePhoto, visibleRecord, writableRecord, type PlanSite } from '../../supabase/functions/storage/index';
import { accessKey, needsFullPull, OFFICE_ACCESS } from '../../src/lib/sync-access';
import type { Session } from '../../src/lib/auth';

const base = { operator: false, email: 'polier@firma.at', sites: [] as string[], toolSites: {} as Record<string, string[]>, tools: [] as string[] };
const polier = accessOf({ ...base, role: 'polier', sites: ['p:A'], tools: ['photos', 'reports', 'defects'] });
const polierPrices = accessOf({ ...base, role: 'polier', sites: ['p:A'], toolSites: { 'perm:prices': ['all'] } });
const arbeiter = accessOf({ ...base, role: 'arbeiter', email: 'max@firma.at', sites: ['p:A'], tools: ['photos', 'times'] });
const buero = accessOf({ ...base, role: 'buero' });
const row = (store: string, id: string, data: Record<string, unknown>) => ({ store, id, data, updated_at: '2026-11-17T10:00:00Z', deleted_at: null as string | null });

describe('Rechte am Server: Zugriff', () => {
  it('Büro, Admin und Betreiber sehen alles, Polier/Arbeiter nicht', () => {
    expect(buero.office).toBe(true);
    expect(accessOf({ ...base, role: 'admin' }).office).toBe(true);
    expect(accessOf({ ...base, role: 'polier', operator: true }).office).toBe(true);
    expect(polier.office).toBe(false);
    expect(polier.prices).toBe(false);
    expect(polierPrices.prices).toBe(true);
  });

  it('Werkzeuge: leere Liste = alle; Zeiten auch mit der Einteilung', () => {
    expect(hasTool(polierPrices, 'materials')).toBe(true);
    expect(hasTool(polier, 'materials')).toBe(false);
    expect(hasTool(accessOf({ ...base, role: 'polier', tools: ['workers'] }), 'times')).toBe(true);
  });

  it('Projekte: gemeinsame Liste oder bei einem Werkzeug ausgewählt; ohne Projekt wie in der App', () => {
    expect(canProject(polier, 'A')).toBe(true);
    expect(canProject(polier, 'B')).toBe(false);
    const perTool = accessOf({ ...base, role: 'polier', toolSites: { photos: ['p:B'], 'perm:prices': ['p:C'] } });
    expect(canProject(perTool, 'B')).toBe(true);
    // die Preis-Freigabe gibt kein Projekt frei
    expect(canProject(perTool, 'C')).toBe(false);
    // frei eingetippte Baustelle: ohne Auswahl sichtbar, sonst nur ausgewählte Namen
    expect(canProject(accessOf({ ...base, role: 'polier' }), null, 'Irgendwo')).toBe(true);
    expect(canProject(polier, null, 'Irgendwo')).toBe(false);
    expect(canProject(accessOf({ ...base, role: 'polier', sites: ['n:irgendwo'] }), null, ' Irgendwo ')).toBe(true);
  });
});

describe('Rechte am Server: lesen', () => {
  it('Datensätze anderer Projekte kommen als gelöscht', () => {
    const plan = row('plans', 'p1', { id: 'p1', projectId: 'B' });
    const out = visibleRecord(plan, polier);
    expect(out.deleted_at).toBe(plan.updated_at);
    expect(out.data).toEqual({});
    expect(visibleRecord(row('plans', 'p2', { projectId: 'A' }), polier).deleted_at).toBeNull();
    expect(visibleRecord(row('projects', 'B', { name: 'B' }), polier).deleted_at).not.toBeNull();
    expect(visibleRecord(row('projects', 'A', { name: 'A' }), polier).deleted_at).toBeNull();
    expect(visibleRecord(plan, buero)).toBe(plan);
  });

  it('Berichte ohne Projekt: Baustellenname aus dem Kopf', () => {
    const a = accessOf({ ...base, role: 'polier', sites: ['n:halle 3'] });
    expect(visibleRecord(row('reports', 'r1', { projectId: null, head: { site: 'Halle 3', project: '' } }), a).deleted_at).toBeNull();
    expect(visibleRecord(row('reports', 'r2', { projectId: null, head: { site: 'Halle 4', project: '' } }), a).deleted_at).not.toBeNull();
  });

  it('Preise nur mit „Preise und Summen“', () => {
    const lv = row('lvDocs', 'lv1', { projectId: 'A', positions: [{ id: 'x', shortText: 'Linie', unitPrice: 3.5, totalPrice: 350 }] });
    const stripped = visibleRecord(lv, polier).data.positions as { unitPrice: unknown; totalPrice: unknown; shortText: string }[];
    expect(stripped[0]).toMatchObject({ shortText: 'Linie', unitPrice: null, totalPrice: null });
    const kept = visibleRecord(lv, polierPrices).data.positions as { unitPrice: unknown }[];
    expect(kept[0].unitPrice).toBe(3.5);
    expect(stripPrices('materialItems', { price: 12, name: 'Farbe' })).toEqual({ price: null, name: 'Farbe' });
  });

  it('firmenweite Daten nur mit passendem Werkzeug', () => {
    const material = row('materials', 'm1', { name: 'Farbe', price: 9 });
    expect(visibleRecord(material, polier).deleted_at).not.toBeNull();
    expect(visibleRecord(material, polierPrices).deleted_at).toBeNull();
    // Personal: Berichte brauchen die Mannschaft
    expect(visibleRecord(row('workers', 'w1', { firstName: 'Anna' }), polier).deleted_at).toBeNull();
    expect(visibleRecord(row('weeks', '2026-W47', { sites: [] }), polier).deleted_at).toBeNull();
    // Arbeiter mit nur Zeiten: nur der eigene Eintrag
    expect(visibleRecord(row('workers', 'w1', { firstName: 'Anna', userEmail: 'anna@firma.at' }), arbeiter).deleted_at).not.toBeNull();
    expect(visibleRecord(row('workers', 'w2', { firstName: 'Max', userEmail: 'MAX@firma.at' }), arbeiter).deleted_at).toBeNull();
    // Formularvorlagen nur mit Berichte
    expect(visibleRecord(row('formTemplates', 't1', { name: 'Abnahme' }), arbeiter).deleted_at).not.toBeNull();
    expect(visibleRecord(row('formTemplates', 't1', { name: 'Abnahme' }), polier).deleted_at).toBeNull();
  });

  it('SV-Nummer der Arbeiter nur für das Büro', () => {
    const anna = row('workers', 'w1', { firstName: 'Anna', svNumber: '1234 010180', userEmail: 'max@firma.at' });
    expect(visibleRecord(anna, polier).data).toEqual({ firstName: 'Anna', userEmail: 'max@firma.at' });
    expect(visibleRecord(anna, arbeiter).data.svNumber).toBeUndefined(); // auch die eigene nicht
    expect(visibleRecord(anna, buero).data.svNumber).toBe('1234 010180');
  });

  it('Mängelpunkte über ihren Mängelplan', () => {
    const plans = new Map<string, PlanSite>([
      ['dA', { projectId: 'A', siteName: '' }],
      ['dB', { projectId: 'B', siteName: '' }],
    ]);
    expect(visibleRecord(row('defectMarks', 'm1', { planId: 'dA' }), polier, plans).deleted_at).toBeNull();
    expect(visibleRecord(row('defectMarks', 'm2', { planId: 'dB' }), polier, plans).deleted_at).not.toBeNull();
    expect(visibleRecord(row('defectMarks', 'm3', { planId: 'weg' }), polier, plans).deleted_at).not.toBeNull();
  });
});

describe('Rechte am Server: schreiben', () => {
  it('nur in freigegebenen Projekten; verschieben in ein fremdes Projekt nicht', () => {
    expect(writableRecord(polier, 'plans', 'p1', { projectId: 'A' }, false, null)).toEqual({ projectId: 'A' });
    expect(writableRecord(polier, 'plans', 'p1', { projectId: 'B' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'plans', 'p1', { projectId: 'A' }, false, { projectId: 'B' })).toBeNull();
    expect(writableRecord(polier, 'plans', 'p1', {}, true, { projectId: 'B' })).toBeNull();
    expect(writableRecord(polier, 'plans', 'p1', {}, true, { projectId: 'A' })).toEqual({});
  });

  it('Projekte anlegen und löschen nur das Büro', () => {
    expect(writableRecord(polier, 'projects', 'A', { name: 'A' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'projects', 'A', {}, true, { name: 'A' })).toBeNull();
    expect(writableRecord(polier, 'projects', 'A', { name: 'A neu' }, false, { name: 'A' })).toEqual({ name: 'A neu' });
    expect(writableRecord(buero, 'projects', 'X', { name: 'X' }, false, null)).toEqual({ name: 'X' });
    // Papierkorb: hineinlegen nur das Büro, zurückholen jeder mit Zugriff
    expect(writableRecord(polier, 'projects', 'A', { name: 'A', deletedAt: 5 }, false, { name: 'A', deletedAt: null })).toBeNull();
    expect(writableRecord(polier, 'projects', 'A', { name: 'A', deletedAt: null }, false, { name: 'A', deletedAt: 5 })).toEqual({ name: 'A', deletedAt: null });
    expect(writableRecord(buero, 'projects', 'A', { name: 'A', deletedAt: 5 }, false, { name: 'A' })).toEqual({ name: 'A', deletedAt: 5 });
  });

  it('Firmen-Einstellungen, Formularvorlagen und Zeitdaten', () => {
    expect(writableRecord(polier, 'meta', 'companyName', { value: 'Hack' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'meta', 'deletedProjects', { value: ['A'] }, false, null)).toBeNull();
    expect(writableRecord(polier, 'meta', 'absences', { value: [] }, false, null)).toEqual({ value: [] });
    expect(writableRecord(polier, 'formTemplates', 't1', { name: 'x' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'timeDays', 'w|2026-11-17', { lines: [] }, false, null)).toBeNull();
    // Personal nur mit Team, Material nur mit Material
    expect(writableRecord(polier, 'workers', 'w1', { firstName: 'X' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'materials', 'm1', { name: 'X' }, false, null)).toBeNull();
    expect(writableRecord(polier, 'weeks', '2026-W47', { sites: [] }, false, null)).toEqual({ sites: [] });
  });

  it('SV-Nummer: Polier mit Team ändert sie nicht, die gespeicherte bleibt', () => {
    const team = accessOf({ ...base, role: 'polier', tools: ['workers'] });
    expect(writableRecord(team, 'workers', 'w1', { firstName: 'Anna B.' }, false, { firstName: 'Anna', svNumber: '1234 010180' })).toEqual({ firstName: 'Anna B.', svNumber: '1234 010180' });
    expect(writableRecord(team, 'workers', 'w1', { firstName: 'Anna', svNumber: '9999 999999' }, false, { firstName: 'Anna' })).toEqual({ firstName: 'Anna' });
    expect(writableRecord(buero, 'workers', 'w1', { firstName: 'Anna', svNumber: '9999 999999' }, false, { firstName: 'Anna', svNumber: '1234 010180' })).toEqual({ firstName: 'Anna', svNumber: '9999 999999' });
  });

  it('ohne Preis-Freigabe bleiben gespeicherte Preise erhalten', () => {
    const existing = { projectId: 'A', positions: [{ id: 'x', unitPrice: 3.5, totalPrice: 350 }] };
    const incoming = { projectId: 'A', positions: [{ id: 'x', unitPrice: null, totalPrice: null, quantity: 120 }, { id: 'y', unitPrice: 99, totalPrice: 99 }] };
    const out = writableRecord(polier, 'lvDocs', 'lv1', incoming, false, existing)!;
    expect(out.positions).toEqual([
      { id: 'x', unitPrice: 3.5, totalPrice: 350, quantity: 120 },
      { id: 'y', unitPrice: null, totalPrice: null },
    ]);
    expect(keepPrices('materialItems', { price: 1, name: 'n' }, { price: 7 })).toEqual({ price: 7, name: 'n' });
    // mit Freigabe: wie gesendet
    expect(writableRecord(polierPrices, 'lvDocs', 'lv1', incoming, false, existing)).toBe(incoming);
  });

  it('Mängelpunkte nur auf Plänen freigegebener Projekte', () => {
    const plans = new Map<string, PlanSite>([
      ['dA', { projectId: 'A', siteName: '' }],
      ['dB', { projectId: 'B', siteName: '' }],
    ]);
    expect(writableRecord(polier, 'defectMarks', 'm1', { planId: 'dA' }, false, null, plans)).toEqual({ planId: 'dA' });
    expect(writableRecord(polier, 'defectMarks', 'm1', { planId: 'dB' }, false, null, plans)).toBeNull();
    expect(writableRecord(polier, 'defectMarks', 'm1', {}, true, { planId: 'dB' }, plans)).toBeNull();
  });
});

describe('Rechte am Server: Fotos und Dateien', () => {
  it('Fotos nur freigegebener Projekte', () => {
    expect(photoAllowed(polier, { projectId: 'A', siteName: 'A' })).toBe(true);
    expect(photoAllowed(polier, { projectId: 'B', siteName: 'B' })).toBe(false);
    const p = { id: 'f1', data: { projectId: 'B' }, deleted_at: null, updated_at: '2026-11-17T10:00:00Z' };
    expect(visiblePhoto(p, polier)).toMatchObject({ data: {}, deleted_at: p.updated_at });
    expect(visiblePhoto(p, buero)).toBe(p);
  });

  it('Dateischlüssel und Zugriff', () => {
    expect(fileKeyOwner('photos/abcd1234/data.jpg')).toEqual({ kind: 'photo', id: 'abcd1234' });
    expect(fileKeyOwner('files/zeit_w1_2026-11/data.bin')).toEqual({ kind: 'time', id: 'zeit_w1_2026-11' });
    expect(fileKeyOwner('files/plan123/data.bin')).toEqual({ kind: 'file', id: 'plan123' });
    const unknown = { known: false, allowed: false };
    expect(fileAllowed(polier, 'file', 'PUT', unknown)).toBe(true);
    expect(fileAllowed(polier, 'file', 'GET', unknown)).toBe(false);
    expect(fileAllowed(polier, 'photo', 'DELETE', unknown)).toBe(false);
    expect(fileAllowed(polier, 'file', 'GET', { known: true, allowed: false })).toBe(false);
    expect(fileAllowed(polier, 'file', 'PUT', { known: true, allowed: false })).toBe(false);
    expect(fileAllowed(polier, 'file', 'GET', { known: true, allowed: true })).toBe(true);
    expect(fileAllowed(polier, 'time', 'GET', { known: true, allowed: true })).toBe(false);
    expect(fileAllowed(buero, 'time', 'GET', unknown)).toBe(true);
  });
});

describe('App: Freigaben für den Abgleich', () => {
  const session = (patch: Partial<Session>): Session =>
    ({ userId: 'u', email: 'x@y.at', name: 'X', role: 'polier', companyId: 'ws', companyName: 'F', operator: false, phone: '', pkg: null, workspaceActive: true, pricePerUser: 0, members: 1, tools: [], sites: [], toolSites: {}, providers: [], ...patch }) as Session;

  it('Kennung: Büro gleich, Polier je Freigabe; offline ohne Kontext unbekannt', () => {
    expect(accessKey(session({ role: 'admin' }))).toBe(OFFICE_ACCESS);
    expect(accessKey(session({ role: 'buero', sites: ['p:A'] }))).toBe(OFFICE_ACCESS);
    expect(accessKey(session({ companyId: '' }))).toBe('');
    const a = accessKey(session({ sites: ['p:B', 'p:A'] }));
    expect(a).toBe(accessKey(session({ sites: ['p:A', 'p:B'] })));
    expect(a).not.toBe(accessKey(session({ sites: ['p:A'] })));
    expect(a).not.toBe(accessKey(session({ sites: ['p:A', 'p:B'], toolSites: { 'perm:prices': ['all'] } as Session['toolSites'] })));
  });

  it('einmal komplett neu abgleichen, wenn sich die Freigaben ändern (Büro nicht beim ersten Mal)', () => {
    expect(needsFullPull(undefined, 'v1:polier|||')).toBe(true);
    expect(needsFullPull('v1:polier|||', 'v1:polier|||')).toBe(false);
    expect(needsFullPull('v1:polier|||', 'v1:polier||p:A|')).toBe(true);
    expect(needsFullPull(undefined, OFFICE_ACCESS)).toBe(false);
    expect(needsFullPull('v1:polier|||', OFFICE_ACCESS)).toBe(true);
    expect(needsFullPull('v1:polier|||', '')).toBe(false);
  });
});
